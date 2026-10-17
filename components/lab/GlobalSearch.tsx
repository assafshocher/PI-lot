"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, CalendarDays, FolderKanban, Search, Users, X } from "lucide-react";
import { buildSearchIndex, searchLab, type SearchKind, type SearchResult } from "./global-search";
import { type LabRecord, type LabState } from "./model";
import "./global-search.css";

const icons = { student: Users, project: FolderKanban, deadline: CalendarDays };
const typeLabels: Record<SearchKind, string> = { student: "Person", project: "Project", deadline: "Deadline" };

export default function GlobalSearch({ state, open, loading = false }: { state: LabState; open: (record: LabRecord) => void; loading?: boolean }) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState(-1);
  const [showAll, setShowAll] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const wrapper = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const index = useMemo(() => buildSearchIndex(state), [state]);
  const groups = useMemo(() => searchLab(index, query), [index, query]);
  const total = groups.reduce((sum, group) => sum + group.results.length, 0);
  const visibleGroups = useMemo(() => groups.map(group => ({ ...group, total: group.results.length, results: showAll ? group.results : group.results.slice(0, 7) })), [groups, showAll]);
  const results = useMemo(() => visibleGroups.flatMap(group => group.results), [visibleGroups]);
  const hasMore = total > results.length;
  const optionCount = results.length + (hasMore ? 1 : 0);
  const activeResult = results[active];
  const resultId = (result: SearchResult) => `${id}-${result.record.kind}-${result.record.id}`;
  const placePanel = useCallback(() => {
    const box = wrapper.current?.getBoundingClientRect();
    if (!box) return;
    const viewport = window.visualViewport;
    const width = Math.min(440, window.innerWidth - 24);
    const top = box.bottom + 8;
    setPosition({ width, left: Math.max(12, Math.min(box.left, window.innerWidth - width - 12)), top, maxHeight: Math.max(120, Math.min(520, (viewport?.height || window.innerHeight) + (viewport?.offsetTop || 0) - top - 12)) });
  }, []);
  const show = () => { placePanel(); setExpanded(true); };
  const choose = (result: SearchResult) => { setExpanded(false); setQuery(""); setActive(-1); setShowAll(false); open(result.record); };
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !wrapper.current?.contains(event.target) && !panel.current?.contains(event.target)) setExpanded(false); };
    const reposition = () => placePanel();
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", reposition); window.removeEventListener("scroll", reposition, true); window.visualViewport?.removeEventListener("resize", reposition); };
  }, [expanded, placePanel]);
  useEffect(() => {
    const shortcut = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && !document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]:not([aria-hidden="true"])')) { event.preventDefault(); input.current?.focus(); placePanel(); setExpanded(true); }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [placePanel]);
  const activeId = activeResult ? resultId(activeResult) : hasMore && active === results.length ? `${id}-more` : undefined;
  useEffect(() => { if (expanded && activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" }); }, [activeId, expanded]);
  const revealAll = () => { setShowAll(true); setActive(-1); input.current?.focus(); };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); show();
      if (optionCount) setActive(previous => event.key === "ArrowDown" ? (previous + 1) % optionCount : previous <= 0 ? optionCount - 1 : previous - 1);
    } else if (event.key === "Enter" && expanded && results.length) { event.preventDefault(); if (hasMore && active === results.length) revealAll(); else choose(activeResult || results[0]); }
    else if (event.key === "Escape") { event.preventDefault(); setExpanded(false); setActive(-1); }
    else if (event.key === "Tab") setExpanded(false);
  };
  return <div className="lab-global-search" ref={wrapper}>
    <div className={`lab-global-search-field ${expanded ? "is-open" : ""}`}>
      <Search size={16} aria-hidden="true" />
      <input ref={input} role="combobox" aria-label="Search all lab records" aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-results`} aria-activedescendant={expanded ? activeId : undefined} autoComplete="off" spellCheck={false} placeholder="Search lab…" value={query} onFocus={show} onChange={event => { setQuery(event.target.value); setActive(-1); setShowAll(false); show(); }} onKeyDown={onKeyDown} onBlur={event => { if (!panel.current?.contains(event.relatedTarget) && !wrapper.current?.contains(event.relatedTarget)) setExpanded(false); }} />
      {query ? <button type="button" aria-label="Clear lab search" onMouseDown={event => event.preventDefault()} onClick={() => { setQuery(""); setActive(-1); setShowAll(false); input.current?.focus(); show(); }}><X size={14} /></button> : <kbd title="Command or Control K">⌘ K</kbd>}
    </div>
    {expanded && createPortal(<div ref={panel} className="lab-global-search-panel" style={position}>
      <div className="lab-global-search-intro"><span>Search your whole lab</span><button type="button" aria-label="Close lab search" onMouseDown={event => event.preventDefault()} onClick={() => { setExpanded(false); input.current?.focus(); }}><X size={15} /></button></div>
      <div className="lab-global-search-announcement" role="status" aria-live="polite">{loading ? "Loading your records…" : !query.trim() ? "Find people, projects, and deadlines by name or notes." : `${total} ${total === 1 ? "result" : "results"} across all records, regardless of tab filters.`}</div>
      <div id={`${id}-results`} role="listbox" aria-label="Lab search results" className="lab-global-search-results">
        {visibleGroups.map(group => { const Icon = icons[group.kind]; return <div role="group" aria-labelledby={`${id}-${group.kind}-heading`} className="lab-global-search-group" key={group.kind}>
          <div id={`${id}-${group.kind}-heading`} className="lab-global-search-heading"><Icon size={13} />{group.label}<span>{group.results.length < group.total ? `${group.results.length} of ${group.total}` : group.total}</span></div>
          {group.results.map(result => <button role="option" aria-selected={activeResult?.record.id === result.record.id && activeResult?.record.kind === result.record.kind} id={resultId(result)} key={result.record.id} type="button" tabIndex={-1} onMouseDown={event => event.preventDefault()} onClick={() => choose(result)} className="lab-global-search-result">
            <span className={`lab-global-search-icon lab-global-search-${group.kind}`}><Icon size={16} /></span><span className="lab-global-search-copy"><strong>{result.title}</strong><small>{typeLabels[group.kind]}{result.subtitle ? ` · ${result.subtitle}` : ""}</small>{result.matchedInNotes && <em>Matches record details</em>}</span><ArrowUpRight size={15} />
          </button>)}
        </div>; })}
        {hasMore && <button id={`${id}-more`} type="button" role="option" aria-selected={active === results.length} tabIndex={-1} className="lab-global-search-more" onMouseDown={event => event.preventDefault()} onClick={revealAll}>Show all {total} results<span>{results.length} shown</span></button>}
      </div>
      {!loading && query.trim() && results.length === 0 && <p className="lab-global-search-empty">No matches. Try part of a name, a research topic, or words from your notes.</p>}
      <div className="lab-global-search-footer"><span>↑ ↓ to browse · Enter to open</span><span>Esc to close</span></div>
    </div>, document.body)}
  </div>;
}
