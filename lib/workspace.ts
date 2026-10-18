import { AppError, type RecordKind } from "./domain";
export type WorkspaceKind = "lab" | "nutri" | "all";
// The combined checkout is for local development only. Each deployed copy sets one app.
export const WORKSPACE_KIND: WorkspaceKind = "lab";
const LAB_KINDS: RecordKind[] = ["project", "student", "deadline", "deadline_target", "project_update", "lab_setting"];
const NUTRI_KINDS: RecordKind[] = ["meal", "saved_dish", "nutrition_goal", "nutrition_profile", "measurement", "daily_expenditure", "daily_checkin", "user_fact", "workout_schedule"];
export function allowedKinds(workspace: WorkspaceKind = WORKSPACE_KIND): RecordKind[] { return [...(workspace !== "nutri" ? LAB_KINDS : []), ...(workspace !== "lab" ? NUTRI_KINDS : [])]; }
export function isKindAllowed(kind: RecordKind, workspace: WorkspaceKind = WORKSPACE_KIND) { return allowedKinds(workspace).includes(kind); }
export function assertKind(kind: RecordKind, workspace: WorkspaceKind = WORKSPACE_KIND) { if (!isKindAllowed(kind, workspace)) throw new AppError(403, "wrong_app", "This record type belongs to a different app."); }
export const hasLab = isKindAllowed("project"), hasNutrition = isKindAllowed("meal");
export const workspaceName = { lab: "PIA", nutri: "NutriChat", all: "Local development workspace" }[WORKSPACE_KIND];
export function assertProductionScope(workspace: WorkspaceKind = WORKSPACE_KIND) { if (process.env.NODE_ENV === "production" && workspace === "all") throw new Error("Set WORKSPACE_KIND to lab or nutri in each separate production site."); }
