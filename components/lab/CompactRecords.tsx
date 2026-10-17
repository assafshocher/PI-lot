"use client";
import { useEffect, useRef } from "react";
import { CalendarDays, ChevronRight, Columns3, FolderKanban, LayoutGrid, List, Users } from "lucide-react";
import { CANDIDATE_STAGES, deadlineDateLabel, initials, personStatusLabel, projectStatusValue, recordName, type LabRecord, type LabState } from "./model";
import "./compact.css";

export type RecordView = "grid" | "list" | "compact";
export function ViewPicker({ value, change, timeline = false }: { value: RecordView; change: (view: RecordView) => void; timeline?: boolean }) {
  return <div className="lab-segmented lab-view-toggle" aria-label="Display layout">{([{ value: "grid", label: timeline ? "Timeline" : "Cards", Icon: timeline ? CalendarDays : LayoutGrid }, { value: "list", label: "Single-line list", Icon: List }, { value: "compact", label: "Compact columns", Icon: Columns3 }] as const).map(({ value: view, label, Icon }) => <button type="button" key={view} title={label} aria-label={label} aria-pressed={value === view} onClick={() => change(view)}><Icon size={16} /><span className="lab-view-label">{label === "Single-line list" ? "List" : label === "Compact columns" ? "Compact" : label}</span></button>)}</div>;
}
export function toggleChoice(current: string[], value: string) { return current.includes(value) ? current.filter(item => item !== value) : [...current, value]; }
export function matchesChoices(selected: string[], value: string) { return !selected.length || selected.includes(value); }
export function MultiFacet({ label, values, selected, change }: { label: string; values: { value: string; label: string }[]; selected: string[]; change: (value: string[]) => void }) {
  const panel = useRef<HTMLDetailsElement>(null);
  useEffect(() => { const close = (e: Event) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !panel.current?.contains(e.target as Node)) panel.current?.removeAttribute("open"); }; document.addEventListener("pointerdown", close); document.addEventListener("keydown", close); return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); }; }, []);
  return <details ref={panel} className="lab-facet"><summary>{label}{selected.length > 0 && <b>{selected.length}</b>}</summary><div className="lab-facet-menu"><div className="lab-facet-title"><strong>{label}</strong><button type="button" onClick={() => change([])}>Clear</button></div>{values.map(option => <label key={option.value}><input type="checkbox" checked={selected.includes(option.value)} onChange={() => change(toggleChoice(selected, option.value))} /><span>{option.label}</span></label>)}<small>Selected options are combined.</small></div></details>;
}
export default function CompactRecords({ records, state, view, open }: { records: LabRecord[]; state: LabState; view: "list" | "compact"; open: (record: LabRecord) => void }) {
  return <div className={`lab-dense-records lab-dense-${view}`} role="list">{records.map(record => {
    const person = record.kind === "student", deadline = record.kind === "deadline";
    const linked = person ? state.projects.filter(p => p.data.connected_students?.includes(record.id) || record.data.connected_projects?.includes(p.id)) : deadline ? state.projects.filter(p => p.data.deadline_id === record.id || state.targets.some(t => t.data.project_id === p.id && t.data.deadline_id === record.id)) : state.students.filter(s => record.data.connected_students?.includes(s.id) || s.data.connected_projects?.includes(record.id));
    const status = person ? personStatusLabel(record.data.lab_status) : deadline ? record.data.date_status === "confirmed" ? "Confirmed date" : record.data.date_status === "estimated" ? "Estimated date" : "Date TBA" : projectStatusValue(record.data.status);
    const meta = person ? record.data.degree || CANDIDATE_STAGES.find(s => s.value === record.data.stage)?.label : deadline ? deadlineDateLabel(record.data) : state.deadlines.find(d => d.id === record.data.deadline_id)?.data.conference_name;
    return <div role="listitem" key={record.id}><button className={`lab-dense-row lab-dense-${record.kind}`} onClick={() => open(record)} title={[recordName(record), status, meta, linked.map(recordName).join(", ")].filter(Boolean).join(" · ")}><span className="lab-dense-icon">{person ? initials(recordName(record)) : deadline ? <CalendarDays size={15} /> : <FolderKanban size={15} />}</span><strong className="lab-dense-name"><span>{recordName(record)}</span></strong><span className="lab-dense-status">{status || "Unspecified"}</span><span className="lab-dense-meta">{meta || "—"}</span><span className="lab-dense-count" aria-label={`${linked.length} ${person || deadline ? "projects" : "people"}`}>{person || deadline ? <FolderKanban size={12} /> : <Users size={12} />}{linked.length}</span><ChevronRight size={13} /></button></div>;
  })}</div>;
}
