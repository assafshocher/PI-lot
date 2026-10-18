"use client";

import { useRef, useState } from "react";
import { Archive, ArrowDownToLine, Check, LoaderCircle, Plus, RotateCcw, Save, Upload, X } from "lucide-react";
import { api, optionsFor, personStatusLabel, personStatusValue, recordName, type LabRecord, type LabState, type Option } from "./model";

function OptionEditor({ title, description, type, state, refresh }: { title: string; description: string; type: string; state: LabState; refresh: () => Promise<void> }) {
  const existing = state.settings.find(s => s.data.setting_type === type);
  const [editing, setEditing] = useState(false);
  const [base, setBase] = useState(existing);
  const [options, setOptions] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const start = () => { setBase(existing); setOptions(optionsFor(state, type).map(o => ({ ...o, label: type === "student_lab_statuses" ? personStatusLabel(o.label) : o.label }))); setEditing(true); setMessage(""); };
  const save = async () => {
    setBusy(true); setMessage("");
    try {
      const cleaned = options.map(o => ({ label: type === "student_lab_statuses" ? personStatusValue(o.label) : o.label.trim(), color: o.color || "#148575" }));
      if (cleaned.some(o => !o.label)) throw new Error("Every option needs a name.");
      if (new Set(cleaned.map(o => o.label.toLowerCase())).size !== cleaned.length) throw new Error("Each option needs a unique name.");
      await api(base ? `/api/records/${base.id}` : "/api/records", { method: base ? "PATCH" : "POST", body: JSON.stringify(base ? { data: { ...base.data, options: cleaned }, expected_revision: base.revision } : { kind: "lab_setting", data: { setting_type: type, options: cleaned } }) });
      await refresh(); setEditing(false); setMessage("Options saved.");
    } catch (err) { setMessage(err instanceof Error ? err.message : "Could not save settings."); } finally { setBusy(false); }
  };
  return <section className="lab-panel lab-setting-panel"><div className="lab-panel-heading"><div><h3>{title}</h3><p>{description}</p></div>{!editing && <button className="lab-button lab-small" onClick={start}>Edit options</button>}</div>
    {editing ? <><div className="lab-option-rows">{options.map((option, index) => <div className="lab-option-row" key={index}><input aria-label={`Color for option ${index + 1}`} type="color" value={/^#[0-9a-f]{6}$/i.test(option.color || "") ? option.color : "#148575"} onChange={e => setOptions(previous => previous.map((o, i) => i === index ? { ...o, color: e.target.value } : o))} /><input aria-label={`Option ${index + 1} name`} value={option.label} placeholder="Option name" onChange={e => setOptions(previous => previous.map((o, i) => i === index ? { ...o, label: e.target.value } : o))} /><button className="lab-icon-button" aria-label={`Remove option ${index + 1}`} onClick={() => setOptions(previous => previous.filter((_, i) => i !== index))}><X size={16} /></button></div>)}</div><button className="lab-button lab-quiet lab-small" onClick={() => setOptions(previous => [...previous, { label: "", color: "#148575" }])}><Plus size={15} />Add option</button><p className="lab-field-hint">Removing or renaming an option keeps existing records visible with their original value. Update those records when you are ready.</p><div className="lab-inline-actions"><button className="lab-button lab-small" disabled={busy} onClick={() => { setEditing(false); setMessage(""); }}>Cancel</button><button className="lab-button lab-primary lab-small" disabled={busy} onClick={save}>{busy ? <LoaderCircle size={15} className="lab-spin" /> : <Save size={15} />}Save options</button></div></> : <div className="lab-option-chips">{optionsFor(state, type).map(option => <span key={option.label} className="lab-tag"><span style={{ background: option.color || "#148575" }} />{type === "student_lab_statuses" ? personStatusLabel(option.label) : option.label}</span>)}{optionsFor(state, type).length === 0 && <p className="lab-muted">No options yet. Add your first one above.</p>}</div>}
    {message && <p className={message === "Options saved." ? "lab-success" : "lab-field-error"} role="status">{message}</p>}
  </section>;
}

export default function LabSettings({ state, refresh, notify }: { state: LabState; refresh: () => Promise<void>; notify: (message: string) => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [archived, setArchived] = useState<LabRecord[] | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const exportBackup = async () => {
    setBusy("export"); setError("");
    try {
      const backup = await api<{ records: LabRecord[]; links?: { project_id: string; student_id: string }[]; files?: unknown[]; [key: string]: unknown }>("/api/export");
      const records = backup.records.filter(r => ["project", "student", "deadline", "lab_setting", "deadline_target", "project_update"].includes(r.kind));
      const fileIds = new Set(records.flatMap(record => record.data.files || []).map(file => file.url.startsWith("/api/files/") ? file.url.slice("/api/files/".length) : "").filter(Boolean));
      const lab = { ...backup, records, files: backup.files?.filter(file => typeof file === "object" && file !== null && "id" in file && fileIds.has(String(file.id))), audit_events: undefined };
      const blob = new Blob([JSON.stringify(lab, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `pia-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify("Lab backup downloaded. Uploaded files remain hosted privately.");
    } catch (err) { setError(err instanceof Error ? err.message : "Export failed."); } finally { setBusy(""); }
  };
  const importBackup = async (file: File) => {
    setBusy("import"); setError("");
    try {
      if (file.size > 7 * 1024 * 1024) throw new Error("Choose a JSON backup smaller than 7 MB. Ask your assistant to import a larger backup in batches.");
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.records)) throw new Error("Choose a workspace JSON backup containing records. For an older Base44 export, ask your assistant to migrate it using the app connection.");
      const records = data.records.filter((r: { kind?: string }) => ["project", "student", "deadline", "lab_setting", "deadline_target", "project_update"].includes(r.kind || ""));
      if (!records.length) throw new Error("No PIA records found in this backup.");
      if (records.length > 2000) throw new Error("This backup has more than 2,000 records. Ask your assistant to import it in batches with relationships preserved.");
      const result = await api<{ created: number; skipped: number }>("/api/import", { method: "POST", body: JSON.stringify({ records, links: data.links, mode: "merge" }) });
      await refresh(); notify(`Import complete: ${result.created} added, ${result.skipped} already present.`);
    } catch (err) { setError(err instanceof Error ? err.message : "Import failed."); } finally { setBusy(""); }
  };
  const loadArchived = async () => { setBusy("archive"); setError(""); try { const results = await Promise.all(["project", "student", "deadline"].map(kind => api<{ records: LabRecord[] }>(`/api/records?kind=${kind}&archived=true`))); setArchived(results.flatMap(r => r.records)); } catch (err) { setError(err instanceof Error ? err.message : "Could not load archive."); } finally { setBusy(""); } };
  const restore = async (record: LabRecord) => { setBusy(record.id); setError(""); try { await api(`/api/records/${record.id}/restore`, { method: "POST", body: JSON.stringify({ expected_revision: record.revision }) }); setArchived(previous => previous?.filter(r => r.id !== record.id) || []); await refresh(); notify(`${recordName(record)} restored.`); } catch (err) { setError(err instanceof Error ? err.message : "Could not restore."); } finally { setBusy(""); } };
  return <div className="lab-settings-grid"><div><OptionEditor title="Project statuses" description="A workflow that fits your research." type="project_statuses" state={state} refresh={refresh} /><OptionEditor title="Lab membership" description="Keep track of each person's relationship to the group." type="student_lab_statuses" state={state} refresh={refresh} /><OptionEditor title="Degrees & roles" description="Labels for the people in your lab." type="student_degrees" state={state} refresh={refresh} /></div><div>
    <section className="lab-panel lab-setting-panel"><div className="lab-panel-heading"><div><h3>Your data, kept portable</h3><p>Back up projects, people, deadlines, settings, and their connections.</p></div></div><div className="lab-setting-actions"><button className="lab-button" disabled={!!busy} onClick={exportBackup}>{busy === "export" ? <LoaderCircle size={17} className="lab-spin" /> : <ArrowDownToLine size={17} />}Export lab backup</button><button className="lab-button" disabled={!!busy} onClick={() => input.current?.click()}>{busy === "import" ? <LoaderCircle size={17} className="lab-spin" /> : <Upload size={17} />}Import backup</button><input ref={input} type="file" className="lab-visually-hidden" accept="application/json,.json" onChange={e => { if (e.target.files?.[0]) void importBackup(e.target.files[0]); e.target.value = ""; }} /></div><p className="lab-field-hint">Imports add missing records and preserve existing records. Uploaded files are referenced by private links; the backup does not include their contents.</p></section>
    <section className="lab-panel lab-setting-panel"><div className="lab-panel-heading"><div><h3><Archive size={18} />Archive</h3><p>Bring back projects, people, or deadlines.</p></div></div>{archived === null ? <button className="lab-button" disabled={!!busy} onClick={loadArchived}>{busy === "archive" ? <LoaderCircle size={16} className="lab-spin" /> : <Archive size={16} />}View archived records</button> : archived.length ? <div className="lab-archive-list">{archived.map(record => <div className="lab-archive-row" key={record.id}><div><strong>{recordName(record)}</strong><span>{record.kind === "student" ? "Person" : record.kind}</span></div><button className="lab-icon-button lab-bordered" disabled={!!busy} title="Restore" aria-label={`Restore ${recordName(record)}`} onClick={() => restore(record)}><RotateCcw size={16} /></button></div>)}</div> : <p className="lab-muted"><Check size={16} />Nothing in your archive.</p>}</section>
    <section className="lab-panel lab-setting-panel lab-soft-panel"><h3>A shared home for your assistant</h3><p>Connect this workspace to your preferred AI assistant to work with your lab through conversation. Your saved records stay the source of truth.</p><a className="lab-button" href="/connect">Set up your assistant</a></section>
    {error && <div className="lab-alert lab-alert-error" role="alert">{error}</div>}
  </div></div>;
}
