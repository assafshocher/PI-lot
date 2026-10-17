"use client";
import { useState } from "react";
import { Plus, Trash2, LoaderCircle, Save } from "lucide-react";
import { api, deadlineDateLabel, recordName, type LabData, type LabRecord, type LabState } from "./model";

type Outcome = NonNullable<LabData["outcome"]>;
function StatusOptions() {
  return <><option value="suggested">AI recommended — uncommitted</option><option value="tentative">Tentative — maybe</option><option value="confirmed">Confirmed target</option><option value="submitted">Submitted — paper sent</option></>;
}
function OutcomeOptions() {
  return <><option value="">Decision not recorded</option><option value="pending">Awaiting decision</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option></>;
}

export default function DeadlineTargets({ record, state, refresh, open, onDirtyChange }: { record: LabRecord; state: LabState; refresh: () => Promise<void>; open: (record: LabRecord) => void; onDirtyChange: (dirty: boolean) => void }) {
  const isProject = record.kind === "project";
  const relevant = state.targets.filter(target => target.data[isProject ? "project_id" : "deadline_id"] === record.id);
  const options = (isProject ? state.deadlines : state.projects).filter(other => !relevant.some(target => target.data[isProject ? "deadline_id" : "project_id"] === other.id));
  const [otherId, setOtherId] = useState("");
  const [status, setStatus] = useState("tentative");
  const [outcome, setOutcome] = useState<Outcome | "">("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const saveTarget = async (target: LabRecord, data?: LabData) => {
    setBusy(true); setError("");
    try {
      await api(`/api/records/${target.id}`, { method: data ? "PATCH" : "DELETE", body: JSON.stringify(data ? { data, expected_revision: target.revision } : { expected_revision: target.revision }) });
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update target."); }
    finally { setBusy(false); }
  };
  const changeStatus = (target: LabRecord, nextStatus: string) => {
    const data = { ...target.data, status: nextStatus };
    if (nextStatus !== "submitted") delete data.outcome;
    return saveTarget(target, data);
  };
  const changeOutcome = (target: LabRecord, nextOutcome: Outcome | "") => {
    const data = { ...target.data };
    if (nextOutcome) data.outcome = nextOutcome;
    else delete data.outcome;
    return saveTarget(target, data);
  };
  const add = async () => {
    if (!otherId) return;
    setBusy(true); setError("");
    try {
      await api("/api/records", { method: "POST", body: JSON.stringify({ kind: "deadline_target", data: { project_id: isProject ? record.id : otherId, deadline_id: isProject ? otherId : record.id, status, ...(status === "submitted" && outcome ? { outcome } : {}), notes } }) });
      setOtherId(""); setNotes(""); setOutcome(""); onDirtyChange(Object.keys(noteDrafts).length > 0); await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not add target."); }
    finally { setBusy(false); }
  };
  const saveNotes = async (target: LabRecord) => {
    setBusy(true); setError("");
    try {
      await api(`/api/records/${target.id}`, { method: "PATCH", body: JSON.stringify({ data: { ...target.data, notes: noteDrafts[target.id] ?? target.data.notes ?? "" }, expected_revision: target.revision }) });
      await refresh(); onDirtyChange(Boolean(otherId || notes || Object.keys(noteDrafts).some(id => id !== target.id)));
      setNoteDrafts(previous => { const next = { ...previous }; delete next[target.id]; return next; });
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save target notes."); }
    finally { setBusy(false); }
  };
  return <section className="lab-editor-section">
    <div className="lab-section-heading"><h3>{isProject ? "Submission plans & history" : "Project targets & submission history"}</h3><span>{relevant.length}</span></div>
    <p className="lab-field-hint">AI recommendations and tentative plans are uncommitted possibilities. Confirmed target means a chosen plan. Submitted records an actual paper submission; its decision is recorded separately. Dates shown are conference deadlines, not submission timestamps. Status and decision changes save immediately.</p>
    {relevant.map(target => {
      const other = (isProject ? state.deadlines : state.projects).find(item => item.id === target.data[isProject ? "deadline_id" : "project_id"]);
      const venue = isProject ? other : record;
      const decision = target.data.status === "submitted" ? target.data.outcome : undefined;
      const decisionClass = decision === "accepted" || decision === "rejected" ? `lab-target-${decision}` : "";
      return <div className={`lab-target-card ${decisionClass}`} key={target.id}>
        <div className="lab-target-title"><button type="button" className="lab-text-button" disabled={!other} onClick={() => other && open(other)}>{other ? recordName(other) : "Unavailable record"} ↗</button><button type="button" disabled={busy} className="lab-icon-button" aria-label="Remove submission plan or history link" onClick={() => { if (window.confirm("Remove this submission plan or history link?")) void saveTarget(target); }}><Trash2 size={14} /></button></div>
        {(decision === "accepted" || decision === "rejected") && <p className={`lab-target-outcome ${decisionClass}`}><strong>{decision === "rejected" ? "Rejected from" : "Accepted at"} {venue ? recordName(venue) : "unavailable venue"}</strong></p>}
        {!isProject && other && <div className="lab-target-people">{state.students.filter(person => (other.data.connected_students || []).includes(person.id)).map(person => <button type="button" className="lab-target-chip" key={person.id} onClick={() => open(person)}>{recordName(person)} ↗</button>)}</div>}
        {isProject && <small>Deadline: {other ? deadlineDateLabel(other.data) : "Date TBA"}{other?.data.date_status === "estimated" ? " · Estimated" : ""}</small>}
        <div className="lab-inline-actions">
          <select aria-label="Submission target status" value={target.data.status || "tentative"} disabled={busy} onChange={e => changeStatus(target, e.target.value)}><StatusOptions /></select>
          {target.data.status === "submitted" && <select aria-label={`Submission decision for ${venue ? recordName(venue) : "venue"}`} value={decision || ""} disabled={busy} onChange={e => changeOutcome(target, e.target.value as Outcome | "")}><OutcomeOptions /></select>}
          {target.data.confidence && <span className="lab-tag">{target.data.confidence} {target.data.status === "submitted" ? "evidence confidence" : "scope fit"}</span>}
        </div>
        <textarea aria-label={`Rationale for ${other ? recordName(other) : "target"}`} rows={2} placeholder="Fit, remaining work, or submission date and decision evidence…" value={noteDrafts[target.id] ?? target.data.notes ?? ""} onChange={e => { onDirtyChange(true); setNoteDrafts(previous => ({ ...previous, [target.id]: e.target.value })); }} />
        {noteDrafts[target.id] !== undefined && noteDrafts[target.id] !== (target.data.notes || "") && <button type="button" disabled={busy} className="lab-button lab-small" onClick={() => saveNotes(target)}><Save size={13} />Save target notes</button>}
      </div>;
    })}
    {options.length > 0 && <>
      <div className="lab-field-grid lab-target-add"><select aria-label={isProject ? "Choose submission deadline" : "Choose project for deadline"} value={otherId} onChange={e => { onDirtyChange(true); setOtherId(e.target.value); }}><option value="">Choose {isProject ? "a deadline" : "a project"}…</option>{options.map(other => <option value={other.id} key={other.id}>{recordName(other)}{isProject ? ` · ${deadlineDateLabel(other.data)}` : ""}</option>)}</select><select aria-label="New submission status" value={status} onChange={e => { setStatus(e.target.value); if (e.target.value !== "submitted") setOutcome(""); }}><StatusOptions /></select></div>
      {status === "submitted" && <select aria-label="New submission decision" value={outcome} onChange={e => setOutcome(e.target.value as Outcome | "")}><OutcomeOptions /></select>}
      <input aria-label="Reason for submission target" placeholder="Context, remaining work, or actual submission details…" value={notes} onChange={e => { onDirtyChange(true); setNotes(e.target.value); }} />
      <button className="lab-button lab-small" type="button" disabled={busy || !otherId} onClick={add}>{busy ? <LoaderCircle size={14} className="lab-spin" /> : <Plus size={14} />}Add plan or submission</button>
    </>}
    {!relevant.length && !options.length && <p className="lab-muted">Add {isProject ? "a deadline" : "a project"} to record submission plans or history.</p>}{error && <p className="lab-field-error" role="alert">{error}</p>}
  </section>;
}
