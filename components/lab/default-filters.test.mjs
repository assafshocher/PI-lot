import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "lab-defaults-"));
for (const name of ["model", "default-filters"]) {
  const source = fs.readFileSync(new URL(`./${name}.ts`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}}).outputText.replace('from "./model"', 'from "./model.mjs"');
  fs.writeFileSync(path.join(folder, `${name}.mjs`), output);
}
const { defaultPeopleStatuses, defaultProjectStatuses, DEFAULT_TARGET_FILTERS, deadlinePeriod } = await import(pathToFileURL(path.join(folder, "default-filters.mjs")));
const { personStatusValue, personStatusLabel, personStatusDescription, projectStatusValue, optionsFor, isComplete } = await import(pathToFileURL(path.join(folder, "model.mjs")));
const state = {projects: [], settings: []};
test("people defaults include group members and active candidates only", () => {
  assert.deepEqual(defaultPeopleStatuses(), ["In Group", "Active Candidate"]);
  assert.ok(!defaultPeopleStatuses().includes("Candidate"));
});
test("project defaults include submitted work but exclude plain Done, early ideas and cancellation", () => {
  const labels = ["Done", "Merged", "In Progress", "External", "Canceled", "Cancelled", "Vague Idea", "Half Baked", "Half-baked"];
  assert.deepEqual(defaultProjectStatuses({...state, settings:[{data:{setting_type:"project_statuses",options:labels.map(label=>({label}))}}]}), ["In Progress", "External", "Done + submitted", "Done + accepted", "Rejected + in progress", "Rejected + resubmitted"]);
});
test("project defaults include custom and unspecified states without widening an empty match", () => {
  assert.ok(defaultProjectStatuses({...state,projects:[{data:{status:"Writing up"}},{data:{}}]}).includes("Unspecified"));
  assert.ok(defaultProjectStatuses({...state,projects:[{data:{status:"Writing up"}}]}).includes("Writing up"));
  assert.deepEqual(defaultProjectStatuses({...state,settings:[{data:{setting_type:"project_statuses",options:[{label:"Canceled"}]}}]}),["Done + submitted", "Done + accepted", "Rejected + in progress", "Rejected + resubmitted"]);
});
test("deadline defaults include plans but exclude AI-only recommendations", () => {
  assert.deepEqual(DEFAULT_TARGET_FILTERS,["primary","tentative","confirmed","submitted"]);
  assert.ok(!DEFAULT_TARGET_FILTERS.includes("suggested"));
});
test("past plans are distinct from actual submissions; undated entries stay available", () => {
  const today="2026-10-17";
  assert.equal(deadlinePeriod({date:"2025-11-13"},true,today),"submitted-past");
  assert.equal(deadlinePeriod({date:"2025-11-13"},false,today),"past");
  assert.equal(deadlinePeriod({date:"2026-10-17"},false,today),"upcoming");
  assert.equal(deadlinePeriod({date_status:"tba"},false,today),"upcoming");
  assert.equal(deadlinePeriod({date_status:"estimated",expected_window:{start:"2026-10-01",end:"2026-10-31"}},false,today),"upcoming");
});
process.on("exit", () => fs.rmSync(folder, {recursive:true,force:true}));

test("person terminology maps both old and new labels to stable stored values", () => {
  for (const [stored,display] of [["Active Candidate","Project candidate"],["Candidate","Prospective"],["In Group","In group"]]) { assert.equal(personStatusLabel(stored),display);assert.equal(personStatusLabel(display),display);assert.equal(personStatusValue(display),stored);assert.equal(personStatusValue(stored),stored); }
  for (const custom of ["Other","From Another Lab","Alumni","Visiting researcher"]) { assert.equal(personStatusValue(custom),custom);assert.equal(personStatusLabel(custom),custom); }
  assert.match(personStatusDescription("Project candidate"),/before admission/);assert.match(personStatusDescription("Prospective"),/not yet admitted/);
});
test("status option aliases deduplicate without mutating settings or saved records", () => {
  const settings=[{data:{setting_type:"student_lab_statuses",options:[{label:"Active Candidate",color:"#111111"},{label:"Project candidate",color:"#222222"},{label:"Prospective"},{label:"Candidate"},{label:"Other"},{label:"From Another Lab"}]}}];
  const original=JSON.stringify(settings), choices=optionsFor({...state,settings},"student_lab_statuses");
  assert.deepEqual(choices.map(o=>o.label),["Active Candidate","Candidate","Other","From Another Lab"]);assert.equal(choices[0].color,"#111111");assert.equal(JSON.stringify(settings),original);
});
test("Done + submitted is always selectable and completed without inventing target history", () => {
  const data={...state,projects:[{data:{status:"Done"}},{data:{status:"Done + submitted"}}],settings:[{data:{setting_type:"project_statuses",options:[{label:"Done"},{label:"Writing"}]}}]};
  assert.deepEqual(optionsFor(data,"project_statuses").map(o=>o.label),["Done","Writing","Done + submitted","Done + accepted","Rejected + in progress","Rejected + resubmitted","Merged"]);assert.equal(optionsFor({...state,settings:[{data:{setting_type:"project_statuses",options:[]}}]},"project_statuses")[0].label,"Done");
  const defaults=defaultProjectStatuses(data);assert.ok(defaults.includes("Done + submitted"));assert.ok(!defaults.includes("Done"));assert.ok(isComplete("Done"));assert.ok(isComplete("Done + submitted"));assert.ok(!isComplete("Submitted"));
});

test("Merged is always selectable, hidden by default and complete without mutating settings", () => {
  const settings=[{data:{setting_type:"project_statuses",options:[{label:"Writing"}]}}], original=JSON.stringify(settings);
  const data={...state,settings,projects:[{data:{status:"Merged"}},{data:{status:"merged"}},{data:{status:"In Progress"}}]};
  assert.ok(optionsFor(data,"project_statuses").some(option=>option.label==="Merged"));assert.equal(JSON.stringify(settings),original);
  assert.ok(!defaultProjectStatuses(data).some(status=>/^merged$/i.test(status)));assert.ok(defaultProjectStatuses(data).includes("In Progress"));assert.ok(isComplete("Merged"));assert.ok(isComplete(" merged "));
  const saved={...state,settings:[{data:{setting_type:"project_statuses",options:[{label:"Merged",color:"#123456"}]}}]};assert.equal(optionsFor(saved,"project_statuses").filter(option=>option.label==="Merged").length,1);assert.equal(optionsFor(saved,"project_statuses").find(option=>option.label==="Merged").color,"#123456");
});


test("combined workflow states remain distinct, selectable and visible by default", () => {
  const data={...state, settings:[{data:{setting_type:"project_statuses",options:[]}}]};
  const choices=optionsFor(data,"project_statuses").map(o=>o.label), defaults=defaultProjectStatuses(data);
  for(const status of ["Done + submitted","Done + accepted","Rejected + in progress","Rejected + resubmitted"]) {
    assert.ok(choices.includes(status)); assert.ok(defaults.includes(status));
  }
  assert.ok(!defaults.includes("Done"));
  assert.equal(isComplete("done+accepted"),true);
  assert.equal(isComplete("Rejected + in progress"),false);
  assert.equal(isComplete("Rejected+ resubmitted"),false);
  assert.equal(isComplete("Submitted"),false);
});
test("project status aliases share filters without losing custom labels or changing saved records", () => {
  const data={...state, projects:[{data:{status:"done+accepted"}},{data:{status:" rejected+ IN PROGRESS "}},{data:{status:"Custom research pause"}}],settings:[{data:{setting_type:"project_statuses",options:[{label:"done+accepted",color:"#111111"},{label:"Done + accepted",color:"#222222"},{label:"Custom research pause"}]}}]};
  const original=JSON.stringify(data), choices=optionsFor(data,"project_statuses");
  assert.equal(projectStatusValue(" rejected+ IN PROGRESS "),"Rejected + in progress");
  assert.equal(projectStatusValue("Submitted"),"Submitted");
  assert.equal(projectStatusValue("Custom research pause"),"Custom research pause");
  assert.equal(choices.filter(o=>o.label==="Done + accepted").length,1);
  assert.equal(choices.find(o=>o.label==="Done + accepted").color,"#222222");
  assert.ok(defaultProjectStatuses(data).includes("Rejected + in progress"));
  assert.ok(!defaultProjectStatuses(data).includes("done+accepted"));
  assert.equal(JSON.stringify(data),original);
});
