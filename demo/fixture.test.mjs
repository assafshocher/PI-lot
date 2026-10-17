import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { DEMO_OWNER, demoCounts, demoSql, parseSeedArgs, rebaseDemo, sqlLiteral, validateDemo } from "./fixture.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fictional-lab.json", import.meta.url), "utf8"));
const migration = readFileSync(new URL("../drizzle/0000_groovy_landau.sql", import.meta.url), "utf8");

test("fictional fixture covers workflows, uncertainty and unconnected prospective people", () => {
  assert.equal(validateDemo(fixture), fixture);
  assert.deepEqual(demoCounts(fixture), { student: 12, project: 12, deadline: 8, deadline_target: 15, project_update: 6, lab_setting: 3, relationships: 21 });
  const candidates = fixture.records.filter(record => record.kind === "student" && record.data.lab_status === "Candidate");
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every(person => !fixture.links.some(link => link.student_id === person.id)));
  for (const state of ["Done", "Done + submitted", "Done + accepted", "Rejected + in progress", "Rejected + resubmitted"]) {
    assert.ok(fixture.records.some(record => record.kind === "project" && record.data.status === state));
  }
  for (const state of ["confirmed", "estimated", "tba"]) assert.ok(fixture.records.some(record => record.kind === "deadline" && record.data.date_status === state));
  assert.ok(!fixture.records.some(record => record.kind === "deadline_target" && record.data.project_id === "demo_project_mosaic" && record.data.deadline_id === "demo_deadline_learning"));
});

test("demo rebasing moves history and planned windows together without mutating the source", () => {
  const moved = rebaseDemo(fixture, "2028-01-01");
  const original = fixture.records.find(record => record.id === "demo_deadline_vision");
  const shifted = moved.records.find(record => record.id === original.id);
  assert.equal(original.data.date, "2026-11-16");
  assert.equal(shifted.data.date, "2028-01-30");
  assert.equal(shifted.data.cycle, "2029");
  assert.match(shifted.data.conference_name, /2029/);
  assert.equal(moved.demo.reference_date, "2028-01-01");
  const earlier = moved.records.find(record => record.id === "demo_deadline_earlier");
  assert.ok(earlier.data.date < moved.demo.reference_date);
  const window = moved.records.find(record => record.id === "demo_deadline_scene").data.expected_window;
  assert.equal(Date.parse(window.end) - Date.parse(window.start), 14 * 86_400_000);
  assert.deepEqual(rebaseDemo(moved, "2028-01-01"), moved);
});

test("local seed requires explicit consent and cannot forward remote or config overrides", () => {
  assert.throws(() => parseSeedArgs([]), /--demo/);
  for (const args of [["--demo", "--remote"], ["--remote=false", "--demo"], ["--demo", "--config", "elsewhere.json"], ["--demo", "--persist-to", "/tmp/other"]]) assert.throws(() => parseSeedArgs(args));
  assert.throws(() => parseSeedArgs(["--demo", "--date", "2026-02-30"]));
  assert.throws(() => parseSeedArgs(["--demo", "--date"]));
  assert.deepEqual(parseSeedArgs(["--demo", "--date", "2026-10-18", "--dry-run"]), { demo: true, dryRun: true, date: "2026-10-18", help: false });
});

test("privacy validation rejects provenance, attachments, external links and broken references", () => {
  for (const edit of [
    data => { data.records[0].data.import_provenance = { source: "Base44" }; },
    data => { data.records[0].data.files = [{ name: "private.pdf", url: "/api/files/private" }]; },
    data => { data.records[0].data.email = "real@example.com"; },
    data => { data.records[0].data.links = [{ url: "https://real-lab.example.com/private" }]; },
    data => { data.links[0].student_id = "missing"; },
    data => { data.records[1].id = data.records[0].id; },
  ]) { const changed = structuredClone(fixture); edit(changed); assert.throws(() => validateDemo(changed)); }
});

test("generated SQL preserves quotes, cannot inject statements, and is repeatable without overwriting", () => {
  const changed = structuredClone(fixture);
  const project = changed.records.find(record => record.kind === "project");
  project.data.notes = "A student's note: '); DROP TABLE records; --\nStill only a string.";
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(migration);
    const sql = demoSql(changed);
    database.exec(sql);
    assert.equal(database.prepare("SELECT count(*) AS n FROM records").get().n, 56);
    const row = database.prepare("SELECT user_id,data_json FROM records WHERE id=?").get(project.id);
    assert.equal(row.user_id, DEMO_OWNER);
    assert.equal(JSON.parse(row.data_json).notes, project.data.notes);
    database.prepare("UPDATE records SET revision=5,data_json=json_set(data_json,'$.notes','Edited locally') WHERE id=?").run(project.id);
    database.exec(sql);
    const edited = database.prepare("SELECT revision,data_json FROM records WHERE id=?").get(project.id);
    assert.equal(edited.revision, 5);
    assert.equal(JSON.parse(edited.data_json).notes, "Edited locally");
    assert.equal(database.prepare("SELECT count(*) AS n FROM records").get().n, 56);
    assert.equal(database.prepare("SELECT count(*) AS n FROM lab_links").get().n, 21);
    assert.equal(database.prepare("SELECT count(*) AS n FROM records WHERE user_id <> ?").get(DEMO_OWNER).n, 0);
    assert.equal(database.prepare("SELECT count(*) AS n FROM files").get().n, 0);
  } finally { database.close(); }
  assert.equal(sqlLiteral("a'b"), "'a''b'");
  assert.throws(() => sqlLiteral("bad\0text"));
});
