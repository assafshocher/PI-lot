import { optionsFor, projectStatusValue, todayKey, type LabData, type LabState } from "./model";

export function defaultPeopleStatuses() { return ["In Group", "Active Candidate"]; }
export const DEFAULT_TARGET_FILTERS = ["primary", "tentative", "confirmed", "submitted"];
export function deadlinePeriod(data: LabData, hasSubmitted: boolean, today = todayKey(data.timezone === "unknown" ? "UTC" : data.timezone || "UTC")) {
  const lastDay = data.date || (data.date_status === "estimated" ? data.expected_window?.end : undefined);
  return !lastDay || lastDay >= today ? "upcoming" : hasSubmitted ? "submitted-past" : "past";
}
export function defaultProjectStatuses(state: LabState) {
  const statuses = [...new Set([...optionsFor(state, "project_statuses").map(o => o.label), ...state.projects.map(p => projectStatusValue(p.data.status) || "Unspecified")])];
  const allowed = statuses.filter(status => !/cancel|vague|half[\s-]*baked/i.test(status) && !/^(done|merged)$/i.test(status.trim()));
  // An empty selection means "all" in the filter UI, so retain a valid nonmatching
  // choice when a workspace contains only excluded project states.
  return allowed.length ? allowed : ["In Progress"];
}
