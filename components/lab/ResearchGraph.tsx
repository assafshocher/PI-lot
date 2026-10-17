"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, CalendarDays, Check, ChevronDown, CircleHelp, FolderKanban, Grip, Link2, LoaderCircle, Maximize2, Plus, RotateCcw, SlidersHorizontal, Users, X } from "lucide-react";
import { api, ApiError, CANDIDATE_STAGES, deadlineDateLabel, deadlineSortDate, graphDeadlineDateLabel, shortDeadlineName, initials, optionsFor, personStatusLabel, personStatusValue, personStatusDescription, projectStatusValue, type LabRecord, type LabState } from "./model";
import { buildResearchNetwork, COLUMN_KINDS, COMMITMENT_LABELS, dateCertainty, EMPTY_GRAPH_FILTERS, existingGraphRelation, filterResearchNetwork, graphEdgePath, graphEdgeStatus, graphFacetOptions, graphScale, layoutResearchGraph, relationPair, type Commitment, type FilterKey, type GraphDensity, type GraphEdge, type GraphFilters, type GraphKind, type GraphNode, type GraphSort, type PositionedNode } from "./research-graph";
import { defaultPeopleStatuses, defaultProjectStatuses, DEFAULT_TARGET_FILTERS } from "./default-filters";
import FilterToggleGroup from "./FilterToggleGroup";
import "./research-graph.css";

type Props = { state: LabState; open: (record: LabRecord) => void; refresh: () => Promise<void>; notify?: (message: string) => void };
type LinkMode = { source: string; relation: "team" | "target" | null; other: string; status: Commitment; outcome: "" | "pending" | "accepted" | "rejected"; notes: string };
const TITLES: Record<GraphKind, string> = { student: "People", project: "Projects", deadline: "Deadlines" };
const FILTERS: { kind: GraphKind; fields: { key: FilterKey; title: string }[] }[] = [
  { kind: "student", fields: [{ key: "degree", title: "Degree" }, { key: "personStatus", title: "Status" }] },
  { kind: "project", fields: [{ key: "projectStatus", title: "Status" }] },
  { kind: "deadline", fields: [{ key: "deadlinePeriod", title: "Time period" }, { key: "certainty", title: "Date certainty" }, { key: "projectLink", title: "Project links" }, { key: "commitment", title: "Target commitment" }] },
];
function labelFor(key: FilterKey, value: string) {
  if (!value) return "Not set";
  if (key === "personStatus") return personStatusLabel(value);
  if (key === "certainty") return ({ confirmed: "Announced date", estimated: "Estimated date", tba: "Date TBA" } as Record<string, string>)[value] || value;
  if (key === "projectLink") return value === "linked" ? "Has a project" : "No projects yet";
  if (key === "deadlinePeriod") return ({ upcoming: "Upcoming / date TBA", "submitted-past": "Past submissions", past: "Other past deadlines" } as Record<string, string>)[value] || value;
  if (key === "commitment") return COMMITMENT_LABELS[value] || value;
  return value;
}
function edgeClass(edge: GraphEdge) { return `rg-edge-${graphEdgeStatus(edge)}`; }
function subtitle(node: GraphNode) {
  const d = node.record.data;
  if (node.kind === "student") return [d.degree, personStatusLabel(d.lab_status)].filter(Boolean).join(" · ") || "Status not set";
  if (node.kind === "project") return projectStatusValue(d.status) || "Status not set";
  return dateCertainty(node.record) === "estimated" ? `Est. ${deadlineDateLabel(d).replace(/^≈ /, "")}` : deadlineDateLabel(d);
}
function detail(node: GraphNode) {
  if (node.kind === "student") return CANDIDATE_STAGES.find(s => s.value === node.record.data.stage)?.label || node.record.data.stage || "";
  if (node.kind === "deadline") return `${node.record.data.deadline_type === "abstract" ? "Abstract" : node.record.data.deadline_type === "other" ? "Other deadline" : "Final submission"}${node.record.data.timezone ? ` · ${node.record.data.timezone === "unknown" ? "Timezone TBA" : node.record.data.timezone}` : ""}`;
  return `${node.degree} ${node.degree === 1 ? "connection" : "connections"}`;
}

export default function ResearchGraph({ state, open, refresh, notify }: Props) {
  const defaults = useMemo<GraphFilters>(() => ({ ...EMPTY_GRAPH_FILTERS, personStatus: defaultPeopleStatuses(), projectStatus: defaultProjectStatuses(state), commitment: [...DEFAULT_TARGET_FILTERS], deadlinePeriod: ["upcoming", "submitted-past"] }), [state]);
  const [customFilters, setCustomFilters] = useState<GraphFilters | null>(null), [showIsolated, setShowIsolated] = useState(true);
  const filters = customFilters || defaults;
  if (customFilters === null && state.projects.length + state.students.length + state.deadlines.length > 0) setCustomFilters(defaults);
  function setFilters(value: GraphFilters | ((current: GraphFilters) => GraphFilters)) { setCustomFilters(current => typeof value === "function" ? value(current || defaults) : value); }
  const [sort, setSort] = useState<GraphSort>("deadline-date"), [density, setDensity] = useState<GraphDensity>("compact"), [zoom, setZoom] = useState("fit"), [viewportWidth, setViewportWidth] = useState(1120);
  const [panelOpen, setPanelOpen] = useState(false), [narrow, setNarrow] = useState(false), [canvasHeight, setCanvasHeight] = useState(600);
  const panel = useRef<HTMLElement>(null), panelToggle = useRef<HTMLButtonElement>(null), focusCanvasOnClose = useRef(false);
  const [filterOpen, setFilterOpen] = useState<GraphKind | null>(null);
  const [hovered, setHovered] = useState<string | null>(null), [focused, setFocused] = useState<string | null>(null), [mode, setMode] = useState<LinkMode | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const [reviewKey, setReviewKey] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null), saving = useRef(false), retry = useRef<{ content: string; key: string } | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const network = useMemo(() => buildResearchNetwork(state, deadlineSortDate), [state]);
  const visible = useMemo(() => filterResearchNetwork(network, filters, "", showIsolated), [network, filters, showIsolated]);
  const layout = useMemo(() => layoutResearchGraph(visible, sort, density, viewportWidth), [visible, sort, density, viewportWidth]);
  const nodes = useMemo(() => new Map(network.nodes.map(n => [n.key, n])), [network]);
  const positions = new Map(layout.nodes.map(n => [n.key, n]));
  const touch = viewportWidth < 620, scale = graphScale(viewportWidth, zoom, layout.width);
  const activeKey = mode?.source || hovered || focused;
  const neighbors = new Set(network.edges.filter(e => e.from === activeKey || e.to === activeKey).flatMap(e => [e.from, e.to]));
  if (activeKey) neighbors.add(activeKey);
  const source = mode ? nodes.get(mode.source) : undefined, other = mode ? nodes.get(mode.other) : undefined;
  const compatible = source && mode?.relation ? network.nodes.filter(n => relationPair(source, n, mode.relation!) && !existingGraphRelation(network, source, n, mode.relation!)).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const selectedCount = Object.values(filters).reduce((sum, values) => sum + values.length, 0);
  const visibleCounts = COLUMN_KINDS.map(kind => visible.nodes.filter(n => n.kind === kind).length);
  const totalCounts = COLUMN_KINDS.map(kind => network.nodes.filter(n => n.kind === kind).length);
  const hiddenByFilters = network.nodes.length - visible.nodes.length;
  useEffect(() => {
    if (!viewport.current) return;
    const measure = () => { if (viewport.current) { setViewportWidth(viewport.current.clientWidth); setCanvasHeight(Math.max(320, window.innerHeight - viewport.current.getBoundingClientRect().top - 18)); } };
    const observer = new ResizeObserver(measure); observer.observe(viewport.current); window.addEventListener("resize", measure); measure();
    return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
  }, []);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving.current) { setMode(null); setFilterOpen(null); setPanelOpen(false); setError(""); } };
    window.addEventListener("keydown", cancel); return () => window.removeEventListener("keydown", cancel);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 899px)");
    const frame = requestAnimationFrame(() => { setNarrow(media.matches); setPanelOpen(!media.matches); });
    const change = () => { setNarrow(media.matches); if (media.matches) setPanelOpen(false); };
    media.addEventListener("change", change); return () => { cancelAnimationFrame(frame); media.removeEventListener("change", change); };
  }, []);
  useEffect(() => {
    if (!panelOpen || !narrow || !panel.current) return;
    const previousOverflow = document.body.style.overflow, returnFocus = panelToggle.current, canvasFocus = viewport.current;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, a[href], [tabindex="0"]')).filter(element => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const trap = (event: KeyboardEvent) => { if (event.key !== "Tab") return; const items = focusable(), first = items[0], last = items.at(-1); if (!first || !last) return; if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); } };
    document.addEventListener("keydown", trap);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", trap); const target = focusCanvasOnClose.current ? canvasFocus : returnFocus; focusCanvasOnClose.current = false; target?.focus({ preventScroll: true }); };
  }, [panelOpen, narrow]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => { if (viewport.current) setCanvasHeight(Math.max(320, window.innerHeight - viewport.current.getBoundingClientRect().top - 18)); });
    return () => cancelAnimationFrame(frame);
  }, [mode, error, message]);
  function facetChoices(key: FilterKey) {
    const choices = graphFacetOptions(network, filters, key);
    const known = key === "personStatus" ? optionsFor(state, "student_lab_statuses") : key === "projectStatus" ? optionsFor(state, "project_statuses") : [];
    for (const option of known) if (!choices.some(choice => choice.value === option.label)) choices.push({ value: option.label, count: 0 });
    return choices;
  }
  function toggleFilter(key: FilterKey, value: string) { setFilters(current => ({ ...current, [key]: current[key].includes(value) ? current[key].filter(v => v !== value) : [...current[key], value] })); }
  function resetFilters() { setFilters(EMPTY_GRAPH_FILTERS); setShowIsolated(true); }
  function restoreDefaults() { setFilters(defaults); setShowIsolated(true); setSort("deadline-date"); }
  function startLink(node: GraphNode) { setMode({ source: node.key, relation: node.kind === "project" ? null : node.kind === "student" ? "team" : "target", other: "", status: "tentative", outcome: "", notes: "" }); retry.current = null; setReviewKey(null); setError(""); setMessage(""); }
  function chooseNode(node: GraphNode) {
    if (!mode) { open(node.record); return; }
    if (source && mode.relation && relationPair(source, node, mode.relation) && !existingGraphRelation(network, source, node, mode.relation)) setMode({ ...mode, other: node.key });
  }
  function jumpColumn(index: number) {
    const position = { left: Math.max(0, layout.columnX[index] * scale - 18), behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" as const : "smooth" as const };
    if (narrow) { focusCanvasOnClose.current = true; setPanelOpen(false); requestAnimationFrame(() => { viewport.current?.scrollTo(position); viewport.current?.focus({ preventScroll: true }); }); }
    else viewport.current?.scrollTo(position);
  }
  async function saveLink() {
    if (!mode || !source || !other || !mode.relation || saving.current) return;
    const pair = relationPair(source, other, mode.relation);
    if (!pair || existingGraphRelation(network, source, other, mode.relation)) { setError("That connection already exists. Open the record to review it."); return; }
    saving.current = true; setBusy(true); setError(""); let saved = false;
    try {
      const [freshSource, freshOther] = await Promise.all([api<{ record: LabRecord }>(`/api/records/${source.record.id}`), api<{ record: LabRecord }>(`/api/records/${other.record.id}`)]);
      if (freshSource.record.deleted_at || freshOther.record.deleted_at || freshSource.record.kind !== source.kind || freshOther.record.kind !== other.kind) throw new Error("A selected record is no longer available. Refresh the map and choose again.");
      const project = freshSource.record.kind === "project" ? freshSource.record : freshOther.record;
      const opposite = project.id === freshSource.record.id ? freshOther.record : freshSource.record;
      if (mode.relation === "team" && ((project.data.connected_students || []).includes(opposite.id) || (opposite.data.connected_projects || []).includes(project.id))) throw new ApiError("This connection already exists.", 409);
      if (mode.relation === "target" && project.data.deadline_id === opposite.id) throw new ApiError("This is already the project's primary deadline. Open the record to review its target commitment.", 409);
      const payload = mode.relation === "team" ? { ...pair, linked: true } : { kind: "deadline_target", data: { ...pair, status: mode.status, ...(mode.status === "submitted" && mode.outcome ? { outcome: mode.outcome } : {}), notes: mode.notes.trim() } };
      const content = JSON.stringify(payload);
      if (retry.current?.content !== content) retry.current = { content, key: crypto.randomUUID() };
      await api(mode.relation === "team" ? "/api/lab/link" : "/api/records", { method: "POST", body: JSON.stringify({ ...payload, idempotency_key: retry.current.key }) });
      saved = true; setMode(null); setMessage(`${source.name} connected to ${other.name}.`); notify?.("Connection saved."); await refresh();
    } catch (failure) {
      if (saved) setError("The connection was saved, but the map could not refresh. Refresh the app to see the latest records.");
      else if (failure instanceof ApiError && failure.status === 409) { setError(`${failure.message} No existing connection was changed. Review the project’s latest connections below.`); setReviewKey(source.kind === "project" ? source.key : other.key); setMode(null); try { await refresh(); } catch { setError(`${failure.message} The map could not refresh. Refresh the app before reviewing this connection.`); } }
      else setError(failure instanceof Error ? failure.message : "The connection could not be saved. Your selection is still here.");
    } finally { saving.current = false; setBusy(false); }
  }

  return <section className={`research-graph rg-density-${density}${touch ? " rg-touch" : ""}`} style={{ "--rg-add-width": `${layout.addButtonWidth}px`, "--rg-canvas-height": `${canvasHeight}px` } as CSSProperties} aria-label="Research connections graph">
    <div className="rg-heading"><div><h2>Research map</h2></div><div className="rg-total"><span>{totalCounts[0]} people</span><i /> <span>{totalCounts[1]} projects</span><i /><span>{totalCounts[2]} deadlines</span></div></div>
    <div className={`rg-workbench${panelOpen ? " rg-panel-is-open" : ""}`}>
    <div className="rg-map-main" inert={narrow && panelOpen}>
    <button hidden={panelOpen} ref={panelToggle} className="rg-panel-toggle" aria-label="Open map controls" aria-expanded={panelOpen} title="Filter, arrange and read the map" onClick={() => setPanelOpen(true)}><SlidersHorizontal size={19} /></button>
    {mode && source && <div className="rg-link-banner" role="region" aria-label="Add a connection"><div className="rg-link-banner-heading"><span><Link2 size={18} /><strong>Connect {source.name}</strong></span><button disabled={busy} onClick={() => { setMode(null); setError(""); }} aria-label="Cancel adding connection"><X size={18} /></button></div><div className="rg-link-form"><fieldset><legend>Relationship</legend><div>{source.kind !== "deadline" && <button disabled={busy} className={mode.relation === "team" ? "active" : ""} onClick={() => setMode({ ...mode, relation: "team", other: "" })}>Project membership</button>}{source.kind !== "student" && <button disabled={busy} className={mode.relation === "target" ? "active" : ""} onClick={() => setMode({ ...mode, relation: "target", other: "" })}>Submission target</button>}</div></fieldset>{mode.relation && <><label><span>Connect to</span><select aria-label="Choose a compatible record" disabled={busy} value={mode.other} onChange={event => setMode({ ...mode, other: event.target.value })}><option value="">Choose a {source.kind === "project" ? mode.relation === "team" ? "person" : "deadline" : "project"}…</option>{compatible.map(node => <option key={node.key} value={node.key}>{node.name}{!positions.has(node.key) ? " · outside current filters" : ""}</option>)}</select></label>{mode.relation === "target" && <label><span>Commitment</span><select aria-label="New graph target commitment" disabled={busy} value={mode.status} onChange={event => setMode({ ...mode, status: event.target.value as Commitment })}><option value="suggested">AI recommended</option><option value="tentative">Tentative · maybe</option><option value="confirmed">Confirmed target</option><option value="submitted">Submitted · paper sent</option></select></label>}{mode.relation === "target" && mode.status === "submitted" && <label><span>Decision</span><select aria-label="New submission decision" disabled={busy} value={mode.outcome} onChange={event => setMode({ ...mode, outcome: event.target.value as LinkMode["outcome"] })}><option value="">Not recorded</option><option value="pending">Awaiting decision</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></select></label>}<button className="rg-save-link" disabled={busy || !other} onClick={saveLink}>{busy ? <LoaderCircle size={16} className="lab-spin" /> : <Plus size={16} />}{busy ? "Saving…" : "Add connection"}</button></>}</div>{mode.relation === "target" && <label className="rg-link-note"><span>Reason / context <small>optional</small></span><input value={mode.notes} maxLength={4000} disabled={busy} onChange={event => setMode({ ...mode, notes: event.target.value })} placeholder={mode.status === "submitted" ? "Submission context or evidence…" : "Why this deadline might fit…"} /></label>}<p>{mode.relation ? compatible.length ? "Choose from the list or click an outlined compatible node. Existing links are excluded. Nothing saves until you add it." : "No new compatible records are available. Existing connections can be reviewed in the record." : "Choose the relationship you want to add."} Press Escape to cancel.{mode.relation === "target" && " Date certainty belongs to the deadline and is independent of this commitment."}{mode.relation === "target" && mode.status === "submitted" && " Submitted records an actual paper sent. Update its decision in the project details."}</p></div>}
    {(message || error) && <div className={error ? "rg-feedback rg-error" : "rg-feedback"} role={error ? "alert" : "status"}>{error ? <CircleHelp size={17} /> : <Check size={17} />}<span>{error || message}</span>{reviewKey && <button className="rg-review-connection" onClick={() => { const node = nodes.get(reviewKey); if (node) open(node.record); }}>Review project</button>}<button aria-label="Dismiss graph message" onClick={() => { setError(""); setMessage(""); setReviewKey(null); }}><X size={15} /></button></div>}

    <div className="rg-viewport" ref={viewport} tabIndex={0} role="region" aria-label="Research graph canvas; scroll to explore all records" onPointerDown={event => { if (event.pointerType !== "mouse" || (event.target as HTMLElement).closest("button, select, input, a")) return; drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (drag.current) { event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x); event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y); } }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <div className="rg-spacer" style={{ width: layout.width * scale, height: Math.max(layout.height, 300) * scale }}><div className="rg-canvas" style={{ width: layout.width, height: Math.max(layout.height, 300), transform: `scale(${scale})` }}>
        {COLUMN_KINDS.map((kind, index) => <div key={kind} className={`rg-column-head rg-column-${kind}`} style={{ left: layout.columnX[index], width: layout.nodeWidth }}><span>{kind === "student" ? <Users size={16} /> : kind === "project" ? <FolderKanban size={16} /> : <CalendarDays size={16} />}{TITLES[kind]}</span><b>{visibleCounts[index]}</b></div>)}
        <svg className="rg-edges" width={layout.width} height={Math.max(layout.height, 300)} aria-hidden="true"><defs><pattern id="rg-canvas-dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".65" fill="#d9d2e2" /></pattern></defs><rect width="100%" height="100%" fill="url(#rg-canvas-dots)" />{layout.edges.map(edge => {
          const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return null;
          const duplicatePair = edge.kind === "primary" && layout.edges.some(otherEdge => otherEdge.kind === "target" && otherEdge.from === edge.from && otherEdge.to === edge.to), offset = duplicatePair ? -8 : 0;
          return <path key={edge.key} className={`rg-edge ${edgeClass(edge)} ${activeKey ? edge.from === activeKey || edge.to === activeKey ? "rg-edge-highlight" : "rg-edge-dim" : ""}`} d={graphEdgePath(a, b, offset)}><title>{nodes.get(edge.from)?.name} → {nodes.get(edge.to)?.name}: {edge.label}{edge.duplicateCount ? `; ${edge.duplicateCount + 1} target records, latest shown` : ""}</title></path>;
        })}</svg>
        {layout.nodes.map(node => <GraphNodeCard key={node.key} node={node} state={state} active={neighbors.has(node.key)} dimmed={Boolean(activeKey && !neighbors.has(node.key) && !mode)} isSource={mode?.source === node.key} isChosen={mode?.other === node.key} isCompatible={Boolean(mode?.relation && source && relationPair(source, node, mode.relation) && !existingGraphRelation(network, source, node, mode.relation))} linking={Boolean(mode)} busy={busy} matched={false} onOpen={() => chooseNode(node)} onLink={() => startLink(node)} onHover={value => setHovered(value ? node.key : null)} onFocus={value => setFocused(value ? node.key : null)} />)}
        {COLUMN_KINDS.map((kind, index) => !visibleCounts[index] && <div key={kind} className="rg-empty-column" style={{ left: layout.columnX[index], width: layout.nodeWidth }}><span>{totalCounts[index] ? `No ${TITLES[kind].toLowerCase()} match.` : `No ${TITLES[kind].toLowerCase()} yet.`}</span>{totalCounts[index] > 0 && <button onClick={resetFilters}>Show all records</button>}</div>)}
      </div></div>
    </div>
    <div className="rg-map-footer"><span>{hiddenByFilters > 0 ? `${hiddenByFilters} records hidden by filters.` : "All active records are shown, including those without connections."}</span><span>Hover or focus a node to trace its connections. Click to open; + to connect.</span></div>
    {network.issues.length > 0 && <details className="rg-review"><summary><CircleHelp size={15} />{network.issues.length} relationship reference{network.issues.length === 1 ? "" : "s"} to review<ChevronDown size={14} /></summary><ul>{network.issues.map((issue, i) => <li key={i}><button onClick={() => { const node = nodes.get(issue.ownerKey); if (node) open(node.record); }}>{nodes.get(issue.ownerKey)?.name || "Record"}</button><span>{issue.message}</span></li>)}</ul><p>Unavailable records are not invented. Duplicate target records are preserved; only the latest is drawn.</p></details>}
    <details className="rg-accessible-list"><summary><SlidersHorizontal size={15} />Browse connections as a list<ChevronDown size={14} /></summary><p>The same visible relationships, with explicit labels and keyboard-accessible records.</p><ul>{visible.edges.map(edge => <li key={edge.key}><button onClick={() => open(nodes.get(edge.from)!.record)}>{nodes.get(edge.from)!.name}</button><span className={`rg-list-edge ${edgeClass(edge)}`}>{edge.label}</span><ArrowRight size={13} /><button onClick={() => open(nodes.get(edge.to)!.record)}>{nodes.get(edge.to)!.name}</button></li>)}</ul>{!visible.edges.length && <p>No connections in this view.</p>}</details>
    </div>
    {panelOpen && narrow && <button className="rg-panel-backdrop" aria-label="Close map controls" tabIndex={-1} onClick={() => setPanelOpen(false)} />}
    {panelOpen && <aside ref={panel} className="rg-side-panel" role={narrow ? "dialog" : undefined} aria-modal={narrow ? true : undefined} aria-label="Map controls">
      <div className="rg-panel-heading"><h3>Map controls</h3><button aria-label="Close map controls" onClick={() => { setPanelOpen(false); requestAnimationFrame(() => panelToggle.current?.focus()); }}><X size={18} /></button></div>
    <div className="rg-toolbar"><label className="rg-control"><span>Arrange by</span><select value={sort} onChange={event => setSort(event.target.value as GraphSort)}><option value="connections">Connections · fewer crossings</option><option value="deadline-date">Deadline date</option><option value="person-name">Person name</option><option value="person-status">Person status</option><option value="project-connections">Project connections</option></select></label><label className="rg-isolates"><input type="checkbox" checked={showIsolated} onChange={event => setShowIsolated(event.target.checked)} />Include unconnected</label></div>
    <div className="rg-filter-row">{FILTERS.map(({ kind, fields }) => {
      const count = fields.reduce((sum, field) => sum + filters[field.key].length, 0), total = network.nodes.filter(n => n.kind === kind).length;
      return <details className={`rg-filter ${count ? "rg-filter-active" : ""}`} key={kind} open={filterOpen === kind}><summary onClick={event => { event.preventDefault(); setFilterOpen(filterOpen === kind ? null : kind); }}><span className={`rg-type-icon rg-type-${kind}`}>{kind === "student" ? <Users size={15} /> : kind === "project" ? <FolderKanban size={15} /> : <CalendarDays size={15} />}</span>{TITLES[kind]}<span className="rg-filter-count">{count ? `${count} filters` : total}</span><ChevronDown size={14} /></summary><div className="rg-filter-panel"><div className="rg-filter-panel-title"><strong>{TITLES[kind]} filters</strong><button disabled={!count} onClick={() => setFilters(current => ({ ...current, ...Object.fromEntries(fields.map(field => [field.key, []])) }))}>Reset</button><button aria-label={`Close ${TITLES[kind].toLowerCase()} filters`} onClick={() => setFilterOpen(null)}><X size={16} /></button></div>{fields.map(field => <FilterToggleGroup key={field.key} label={field.title} choices={facetChoices(field.key).map(option => ({ value: option.value, label: labelFor(field.key, option.value), count: option.count, description: field.key === "personStatus" ? personStatusDescription(option.value) : undefined }))} selected={filters[field.key]} change={values => setFilters(current => ({ ...current, [field.key]: values }))} />)}<p className="rg-filter-help">Choose any combination. Counts reflect the other filters for this record type.</p></div></details>;
    })}<div className="rg-filter-actions"><button onClick={resetFilters} disabled={!selectedCount && showIsolated}>Show all</button><button onClick={restoreDefaults}><RotateCcw size={12} />Restore defaults</button></div></div>
    {(selectedCount > 0) && <details className="rg-active-summary"><summary>Selected filters <b>{selectedCount}</b><ChevronDown size={13} /></summary><div className="rg-applied-filters">{(Object.keys(filters) as FilterKey[]).flatMap(key => filters[key].map(value => <button key={`${key}:${value}`} onClick={() => toggleFilter(key, value)}>{labelFor(key, value)}<X size={12} /><span className="rg-sr-only">Remove filter</span></button>))}</div></details>}

    <div className="rg-canvas-toolbar"><nav className="rg-column-nav" aria-label="Navigate graph columns">{COLUMN_KINDS.map((kind, index) => <button key={kind} onClick={() => jumpColumn(index)}><span>{TITLES[kind]}</span><b>{visibleCounts[index]}</b></button>)}</nav><div className="rg-canvas-options"><label><span className="rg-sr-only">Graph density</span><select aria-label="Graph density" value={density} onChange={event => setDensity(event.target.value as GraphDensity)}><option value="compact">Compact</option><option value="cozy">Cozy</option></select></label><label><span className="rg-sr-only">Graph zoom</span><select aria-label="Graph zoom" value={touch && zoom === "0.85" ? "1" : zoom} onChange={event => setZoom(event.target.value)}><option value="fit">Fit columns</option>{!touch && <option value="0.85">85%</option>}<option value="1">100%</option><option value="1.15">115%</option><option value="1.3">130%</option></select></label><button title="Fit columns and return to the top" aria-label="Fit graph columns" onClick={() => { setZoom("fit"); viewport.current?.scrollTo({ left: 0, top: 0, behavior: "instant" }); }}><Maximize2 size={16} /></button></div></div>
    <ConnectionLegend />
    <div className="rg-pan-hint"><Grip size={13} /><span>Pan within the map. Use the column buttons on smaller screens.</span><span>{visible.nodes.length} / {network.nodes.length} records · {visible.edges.length} connections</span></div>
    </aside>}
    </div>
  </section>;
}

function GraphNodeCard({ node, state, active, dimmed, isSource, isChosen, isCompatible, linking, busy, matched, onOpen, onLink, onHover, onFocus }: { node: PositionedNode; state: LabState; active: boolean; dimmed: boolean; isSource: boolean; isChosen: boolean; isCompatible: boolean; linking: boolean; busy: boolean; matched: boolean; onOpen: () => void; onLink: () => void; onHover: (active: boolean) => void; onFocus: (active: boolean) => void }) {
  const status = node.kind === "project" ? projectStatusValue(node.record.data.status) : personStatusValue(node.record.data.lab_status);
  const option = optionsFor(state, node.kind === "project" ? "project_statuses" : "student_lab_statuses").find(o => o.label === status), color = node.kind === "deadline" ? dateCertainty(node.record) === "estimated" ? "#ad8b4e" : dateCertainty(node.record) === "confirmed" ? "#718d66" : "#918799" : option?.color && /^#[0-9a-f]{3,8}$/i.test(option.color) ? option.color : "#8e7caf";
  return <article className={`rg-node rg-node-${node.kind} ${active ? "rg-node-active" : ""} ${dimmed ? "rg-node-dim" : ""} ${isSource ? "rg-node-source" : ""} ${isChosen ? "rg-node-chosen" : ""} ${isCompatible ? "rg-node-compatible" : ""} ${matched ? "rg-node-match" : ""}`} style={{ left: node.x, top: node.y, width: node.width, height: node.height, "--rg-status": color } as CSSProperties} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onFocusCapture={() => onFocus(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) onFocus(false); }}>
    <button className="rg-node-open" aria-label={`${linking ? "Choose" : "Open"} ${node.kind === "student" ? "person" : node.kind} ${node.name}. ${subtitle(node)}. ${node.degree} connections.`} disabled={busy || (linking && !isCompatible)} onClick={onOpen} title={`${node.name}\n${subtitle(node)}${detail(node) ? `\n${detail(node)}` : ""}`}><span className="rg-node-symbol">{node.kind === "student" ? initials(node.name) : node.kind === "project" ? <FolderKanban size={17} /> : <CalendarDays size={17} />}</span><i className="rg-node-status" aria-hidden="true" /><span className="rg-node-copy"><strong>{node.kind === "deadline" ? <><span className="rg-deadline-name">{shortDeadlineName(node.record.data)}</span><span className="rg-deadline-date">· {graphDeadlineDateLabel(node.record.data)}</span></> : node.name}</strong><span className="rg-node-meta">{node.kind === "project" && <i />}{node.kind === "deadline" ? dateCertainty(node.record) === "estimated" ? "Estimated date or window" : dateCertainty(node.record) === "confirmed" ? "Announced date" : "Date to be announced" : subtitle(node)}</span><small>{detail(node)}</small></span>{node.degree === 0 && <span className="rg-node-isolated" title="No connections yet">○</span>}{isChosen && <Check size={15} />}</button><button className="rg-node-add" aria-label={`Add connection for ${node.name}`} title={`Connect ${node.name}`} disabled={busy || linking} onClick={onLink}><Plus size={16} /></button>
  </article>;
}
function ConnectionLegend() {
  return <div className="rg-legend rg-legend-inline"><div><strong>People → project</strong><span><i className="rg-sample rg-edge-active" />Active / open</span><span><i className="rg-sample rg-edge-done" />Done / merged</span><span><i className="rg-sample rg-edge-canceled" />Canceled</span></div><div><strong>Project → deadline</strong><span><i className="rg-sample rg-edge-suggested" />AI recommended</span><span><i className="rg-sample rg-edge-tentative" />Tentative</span><span><i className="rg-sample rg-edge-confirmed" />Confirmed target</span><span><i className="rg-sample rg-edge-primary" />Primary field</span><span><i className="rg-sample rg-edge-submitted" />Submitted</span><span><i className="rg-sample rg-edge-accepted" />Accepted</span><span><i className="rg-sample rg-edge-rejected" />Rejected</span><details className="rg-legend-note"><summary aria-label="How to read the map"><CircleHelp size={15} /><span>About</span></summary><p>Node colors distinguish people, projects and deadlines. A dot shows status; ≈ marks an estimated date. Lines describe project status or target commitment. A primary field alone does not imply a confirmed commitment. Submitted means a paper was sent; accepted and rejected require an explicit recorded decision. Expired plans do not become submissions. Open a record or hover its name for details.</p></details></div></div>;
}
