"use client";
import "./filter-toggles.css";

type Choice = { value: string; label: string; count?: number; color?: string; description?: string };
export default function FilterToggleGroup({ label, choices, selected, change, allCount }: { label: string; choices: Choice[]; selected: string[]; change: (values: string[]) => void; allCount?: number }) {
  return <fieldset className="lab-toggle-facet"><legend>{label}<span>{selected.length ? `${selected.length} selected` : "All"}</span></legend><div className="lab-toggle-choices" role="group" aria-label={`${label} filters`}><button type="button" aria-pressed={!selected.length} className={!selected.length ? "is-selected" : ""} onClick={() => change([])}>All{allCount !== undefined && <small>{allCount}</small>}</button>{choices.map(choice => <button type="button" key={choice.value} aria-pressed={selected.includes(choice.value)} className={selected.includes(choice.value) ? "is-selected" : ""} title={choice.description || undefined} onClick={() => change(selected.includes(choice.value) ? selected.filter(value => value !== choice.value) : [...selected, choice.value])}>{choice.color && <i aria-hidden="true" style={{ background: choice.color }} />}<span>{choice.label}</span>{choice.count !== undefined && <small>{choice.count}</small>}</button>)}</div></fieldset>;
}
