import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const sqlite = new DatabaseSync(':memory:');
const schema = await readFile(new URL('../drizzle/0000_groovy_landau.sql', import.meta.url), 'utf8');
sqlite.exec(schema.replaceAll('--> statement-breakpoint', ''));
class Prepared {
  constructor(sql, values = []) { this.sql = sql; this.values = values; }
  bind(...values) { return new Prepared(this.sql, values); }
  async first() { return sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.values), success: true }; }
  async run() { const r = sqlite.prepare(this.sql).run(...this.values); return { meta: { changes: Number(r.changes) }, success: true }; }
}
let batchTail = Promise.resolve();
const db = {
  prepare(sql) { return new Prepared(sql); },
  async batch(statements) {
    const task = batchTail.then(async () => {
      sqlite.exec('BEGIN');
      try { const result = []; for (const stmt of statements) result.push(await stmt.run()); sqlite.exec('COMMIT'); return result; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    });
    batchTail = task.catch(() => {}); return task;
  }
};
globalThis.__workspaceTestEnv = { DB: db };
const temp = await mkdtemp(join(tmpdir(), 'workspace-backend-test-'));
const source = await readFile(new URL('./data.ts', import.meta.url), 'utf8');
const workspaceSource = await readFile(new URL('./workspace.ts', import.meta.url), 'utf8');
const workspaceJs = ts.transpileModule(workspaceSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace('from "./domain"', 'from "' + new URL('./domain.ts', import.meta.url).href + '"').replace(/export const WORKSPACE_KIND = "(?:all|lab|nutri)";/, 'export const WORKSPACE_KIND = "all";');
await writeFile(join(temp, 'workspace.mjs'), workspaceJs);
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
  .replace('import { env } from "cloudflare:workers";', 'const env = globalThis.__workspaceTestEnv;')
  .replace('from "./domain"', 'from "' + new URL('./domain.ts', import.meta.url).href + '"')
  .replace('from "./workspace"', 'from "./workspace.mjs"');
await writeFile(join(temp, 'data.mjs'), js);
const { writeRecord, getRecord, listRecords, setLabLink, exportData, importData } = await import(pathToFileURL(join(temp, 'data.mjs')).href);
after(async () => { sqlite.close(); delete globalThis.__workspaceTestEnv; await rm(temp, { recursive: true, force: true }); });

test('transactional record lifecycle, idempotency, audit and user isolation', async () => {
  const created = await writeRecord('owner', { kind: 'project', data: { name: 'Original' }, idempotency_key: 'create-one' });
  const replay = await writeRecord('owner', { kind: 'project', data: { name: 'Original' }, idempotency_key: 'create-one' });
  assert.equal(replay.id, created.id); assert.equal(replay.revision, 1);
  await assert.rejects(writeRecord('owner', { kind: 'project', data: { name: 'Different' }, idempotency_key: 'create-one' }), e => e.code === 'idempotency_conflict');
  await assert.rejects(getRecord('other-user', created.id), e => e.status === 404);
  assert.equal((await listRecords('other-user')).records.length, 0);
  const updated = await writeRecord('owner', { id: created.id, data: { name: 'Changed' }, expected_revision: 1, idempotency_key: 'update-one' }, 'update');
  assert.equal(updated.revision, 2);
  await assert.rejects(writeRecord('owner', { id: created.id, data: { name: 'Stale overwrite' }, expected_revision: 1, idempotency_key: 'stale' }, 'update'), e => e.status === 409);
  assert.equal((await getRecord('owner', created.id)).data.name, 'Changed');
  const archived = await writeRecord('owner', { id: created.id, expected_revision: 2 }, 'archive');
  assert.ok(archived.deleted_at); assert.equal((await listRecords('owner')).records.length, 0);
  const restored = await writeRecord('owner', { id: created.id, expected_revision: 3 }, 'restore');
  assert.equal(restored.deleted_at, null); assert.equal(restored.revision, 4);
  const exported = await exportData('owner');
  assert.deepEqual(exported.audit_events.map(e => e.action), ['create', 'update', 'archive', 'restore']);
});

test('atomic normalized lab links survive archiving and reject foreign-owned records', async () => {
  const p = await writeRecord('lab-owner', { kind: 'project', data: { name: 'Project' } });
  const s = await writeRecord('lab-owner', { kind: 'student', data: { name: 'Student', stage: 'Contacted' } });
  const linked = await setLabLink('lab-owner', { project_id: p.id, student_id: s.id, linked: true, idempotency_key: 'link-once' });
  assert.deepEqual(linked.project.data.connected_students, [s.id]); assert.deepEqual(linked.student.data.connected_projects, [p.id]);
  const replay = await setLabLink('lab-owner', { project_id: p.id, student_id: s.id, linked: true, idempotency_key: 'link-once' });
  assert.equal(replay.project.revision, 2);
  const foreign = await writeRecord('someone-else', { kind: 'student', data: { name: 'Private' } });
  await assert.rejects(setLabLink('lab-owner', { project_id: p.id, student_id: foreign.id, linked: true }), e => e.status === 404);
  const archived = await writeRecord('lab-owner', { id: s.id, expected_revision: 2 }, 'archive');
  const restored = await writeRecord('lab-owner', { id: s.id, expected_revision: archived.revision }, 'restore');
  assert.deepEqual(restored.data.connected_projects, [p.id]);
  const disconnected = await setLabLink('lab-owner', { project_id: p.id, student_id: s.id, linked: false });
  assert.deepEqual(disconnected.project.data.connected_students, []); assert.deepEqual(disconnected.student.data.connected_projects, []);
});

test('two edits with one revision cannot silently overwrite each other', async () => {
  const record = await writeRecord('race-owner', { kind: 'project', data: { name: 'Start' } });
  // Each request believes revision 1 is current. D1 batches serialize at the database.
  const results = await Promise.all(['Edit A', 'Edit B'].map(name => writeRecord('race-owner', { id: record.id, expected_revision: 1, data: { name }, idempotency_key: name.replace(' ', '-') }, 'update').catch(e => e)));
  assert.equal(results.filter(r => r.revision === 2).length, 1);
  assert.equal(results.filter(r => r.status === 409).length, 1);
});

test('concurrent identical message retries create one record and one audit event', async () => {
  const input = { kind: 'project', data: { name: 'Only once' }, idempotency_key: 'slack-channel-message-action' };
  const [a, b] = await Promise.all([writeRecord('retry-owner', input), writeRecord('retry-owner', input)]);
  assert.equal(a.id, b.id); const backup = await exportData('retry-owner');
  assert.equal(backup.records.length, 1); assert.equal(backup.audit_events.length, 1);
});

test('safe merge is repeatable and never overwrites existing records', async () => {
  const input = { records: [
    { id: 'import-project', kind: 'project', data: { name: 'Imported project' } },
    { id: 'import-student', kind: 'student', data: { name: 'Imported student' } }
  ], links: [{ project_id: 'import-project', student_id: 'import-student' }] };
  const first = await importData('import-owner', input); assert.equal(first.created, 2); assert.equal(first.links_created, 1);
  const second = await importData('import-owner', input); assert.equal(second.created, 0); assert.equal(second.skipped, 2);
  await importData('import-owner', { records: [{ ...input.records[0], data: { name: 'Must not overwrite' } }] });
  assert.equal((await getRecord('import-owner', 'import-project')).data.name, 'Imported project');
  const backup = await exportData('import-owner');
  assert.equal(backup.records.length, 2); assert.equal(backup.links.length, 1);
});

test('deadline targets validate both references and tenant ownership', async () => {
  const p = await writeRecord('target-owner', { kind: 'project', data: { name: 'A project' } });
  const d = await writeRecord('target-owner', { kind: 'deadline', data: { conference_name: 'A deadline', date: '2027-02-01' } });
  const target = await writeRecord('target-owner', { kind: 'deadline_target', data: { project_id: p.id, deadline_id: d.id, status: 'tentative' } });
  assert.equal(target.data.status, 'tentative');
  await assert.rejects(writeRecord('target-owner', { kind: 'deadline_target', data: { project_id: d.id, deadline_id: p.id } }), e => e.status === 400);
});

test('separate app scopes reject unrelated reads, writes, imports, replays and links', async () => {
  for (const scope of ['lab', 'nutri']) {
    await writeFile(join(temp, 'workspace-' + scope + '.mjs'), workspaceJs.replace('export const WORKSPACE_KIND = "all";', 'export const WORKSPACE_KIND = "' + scope + '";'));
    await writeFile(join(temp, 'data-' + scope + '.mjs'), js.replace('from "./workspace.mjs"', 'from "./workspace-' + scope + '.mjs"'));
  }
  const lab = await import(pathToFileURL(join(temp, 'data-lab.mjs')).href), nutri = await import(pathToFileURL(join(temp, 'data-nutri.mjs')).href);
  const project = await writeRecord('scope-owner', { kind: 'project', data: { name: 'Private lab project' }, idempotency_key: 'lab-replay' });
  const mealInput = { kind: 'meal', data: { name: 'Private nutrition meal', date: '2026-01-01', time_precision: 'date', ingredients: [{ name: 'Test', quantity: 1, unit: 'portion', basis: 'total', nutrients: { calories: 10 } }] }, idempotency_key: 'nutri-replay' };
  const meal = await writeRecord('scope-owner', mealInput);
  assert.deepEqual((await lab.listRecords('scope-owner')).records.map(r => r.id), [project.id]);
  assert.deepEqual((await nutri.listRecords('scope-owner')).records.map(r => r.id), [meal.id]);
  await assert.rejects(lab.getRecord('scope-owner', meal.id), e => e.status === 404);
  await assert.rejects(nutri.getRecord('scope-owner', project.id), e => e.status === 404);
  await assert.rejects(lab.writeRecord('scope-owner', mealInput), e => e.status === 403);
  await assert.rejects(nutri.importData('scope-owner', { records: [{ id: 'foreign', kind: 'student', data: { name: 'Wrong app' } }] }), e => e.status === 403);
  await assert.rejects(nutri.setLabLink('scope-owner', { project_id: project.id, student_id: 's', linked: true }), e => e.status === 403);
  assert.equal((await lab.exportData('scope-owner')).records.length, 1);
  assert.equal((await nutri.exportData('scope-owner')).records.length, 1);
  assert.ok((await lab.exportData('scope-owner')).audit_events.every(e => e.record_id === project.id));
  assert.ok((await nutri.exportData('scope-owner')).audit_events.every(e => e.record_id === meal.id));
});

test('project updates retain sources and validate their project reference', async () => {
  const p = await writeRecord('news-owner', { kind: 'project', data: { name: 'Research' } });
  const update = await writeRecord('news-owner', { kind: 'project_update', data: { project_id: p.id, title: 'Experiment result', summary: 'An authorized source reported a new result.', date: '2026-10-17', sources: [{ label: 'Source message', url: 'https://example.org/message' }], next_action: 'Discuss the result' } });
  assert.equal(update.data.sources.length, 1); assert.equal(update.data.project_id, p.id);
  await assert.rejects(writeRecord('news-owner', { kind: 'project_update', data: { project_id: 'missing-project', title: 'Bad', summary: 'No project', date: '2026-10-17' } }), e => e.status === 404);
});

test('meal changes atomically invalidate prior day confirmations and retries do not invalidate a later confirmation', async () => {
  const owner = 'confirmed-day-owner';
  const check = date => ({ date, nutrition_complete: true, timezone: 'Asia/Jerusalem' });
  const confirm = async id => { const r = await getRecord(owner, id); return writeRecord(owner, { id, data: { ...r.data, nutrition_complete: true }, expected_revision: r.revision }, 'update'); };
  const day1 = await writeRecord(owner, { kind: 'daily_checkin', data: check('2026-01-01') });
  const day2 = await writeRecord(owner, { kind: 'daily_checkin', data: check('2026-01-02') });
  const foreign = await writeRecord('another-confirmed-user', { kind: 'daily_checkin', data: check('2026-01-01') });
  const input = { kind: 'meal', data: { name: 'Meal', date: '2026-01-01', time_precision: 'date', ingredients: [{ name: 'Ingredient', quantity: 1, unit: 'portion', basis: 'total', nutrients: { calories: 100 } }] }, idempotency_key: 'meal-once' };
  let meal = await writeRecord(owner, input);
  assert.equal((await getRecord(owner, day1.id)).data.nutrition_complete, false);
  assert.equal((await getRecord(owner, day1.id)).data.reconfirmation_required, true);
  assert.equal((await getRecord(owner, day2.id)).data.nutrition_complete, true);
  assert.equal((await getRecord('another-confirmed-user', foreign.id)).data.nutrition_complete, true);
  const confirmed = await confirm(day1.id);
  assert.equal(confirmed.data.reconfirmation_required, false);
  await writeRecord(owner, input);
  assert.equal((await getRecord(owner, day1.id)).revision, confirmed.revision);
  meal = await writeRecord(owner, { id: meal.id, expected_revision: meal.revision, data: { ...meal.data, date: '2026-01-02' } }, 'update');
  assert.equal((await getRecord(owner, day1.id)).data.nutrition_complete, false);
  assert.equal((await getRecord(owner, day2.id)).data.nutrition_complete, false);
  await confirm(day2.id);
  await assert.rejects(writeRecord(owner, { id: meal.id, expected_revision: 1, data: meal.data }, 'update'), e => e.status === 409);
  assert.equal((await getRecord(owner, day2.id)).data.nutrition_complete, true);
  meal = await writeRecord(owner, { id: meal.id, expected_revision: meal.revision }, 'archive');
  assert.equal((await getRecord(owner, day2.id)).data.nutrition_complete, false);
  await confirm(day2.id);
  await writeRecord(owner, { id: meal.id, expected_revision: meal.revision }, 'restore');
  assert.equal((await getRecord(owner, day2.id)).data.nutrition_complete, false);
  assert.equal((await exportData(owner)).audit_events.filter(e => e.action === 'meal_changed_reconfirm').length, 5);
});

test('unrelated edits preserve missing legacy references while new references stay owned, typed and active', async () => {
  const owner = 'legacy-reference-owner';
  await importData(owner, { records: [
    { id: 'legacy-ref-project', kind: 'project', data: { name: 'Imported project', deadline_id: 'missing-old-deadline', notes: 'Original notes' } },
    { id: 'legacy-ref-update', kind: 'project_update', data: { project_id: 'missing-old-project', title: 'Historical update', summary: 'Original summary', date: '2026-01-01' } }
  ] });
  let project = await getRecord(owner, 'legacy-ref-project');
  project = await writeRecord(owner, { id: project.id, expected_revision: project.revision, data: { ...project.data, notes: 'Updated notes' } }, 'update');
  assert.equal(project.data.deadline_id, 'missing-old-deadline');
  assert.equal(project.data.notes, 'Updated notes');
  const update = await getRecord(owner, 'legacy-ref-update');
  assert.equal((await writeRecord(owner, { id: update.id, expected_revision: update.revision, data: { ...update.data, summary: 'More context' } }, 'update')).data.project_id, 'missing-old-project');
  await assert.rejects(writeRecord(owner, { kind: 'project', data: { name: 'New project', deadline_id: 'missing-old-deadline' } }), e => e.status === 404);
  await assert.rejects(writeRecord(owner, { id: project.id, expected_revision: project.revision, data: { ...project.data, deadline_id: 'different-missing-deadline' } }, 'update'), e => e.status === 404);
  const foreign = await writeRecord('other-reference-owner', { kind: 'deadline', data: { conference_name: 'Private deadline', date: '2027-01-01' } });
  await assert.rejects(writeRecord(owner, { id: project.id, expected_revision: project.revision, data: { ...project.data, deadline_id: foreign.id } }, 'update'), e => e.status === 404);
  await assert.rejects(getRecord(owner, foreign.id), e => e.status === 404);
  await assert.rejects(writeRecord(owner, { id: project.id, expected_revision: project.revision, data: { ...project.data, deadline_id: project.id } }, 'update'), e => e.status === 400);
  const deadline = await writeRecord(owner, { kind: 'deadline', data: { conference_name: 'Available deadline', date: '2027-02-01' } });
  project = await writeRecord(owner, { id: project.id, expected_revision: project.revision, data: { ...project.data, deadline_id: deadline.id } }, 'update');
  await writeRecord(owner, { id: deadline.id, expected_revision: deadline.revision }, 'archive');
  project = await writeRecord(owner, { id: project.id, expected_revision: project.revision, data: { ...project.data, notes: 'Edit after deadline archived' } }, 'update');
  assert.equal(project.data.deadline_id, deadline.id);
  await assert.rejects(writeRecord(owner, { kind: 'project', data: { name: 'New link to archive', deadline_id: deadline.id } }), e => e.status === 404);
  project = await writeRecord(owner, { id: project.id, expected_revision: project.revision, data: { ...project.data, deadline_id: null } }, 'update');
  assert.equal(project.data.deadline_id, null);
  await assert.rejects(writeRecord(owner, { id: project.id, expected_revision: 1, data: { ...project.data, notes: 'Stale edit' } }, 'update'), e => e.status === 409);
});

test('active target pairs reject duplicate and concurrent creates while retries stay idempotent', async () => {
  const owner='unique-target-owner';
  const project=await writeRecord(owner,{kind:'project',data:{name:'Target project'}});
  const deadline=await writeRecord(owner,{kind:'deadline',data:{conference_name:'Target deadline',date:'2027-01-01'}});
  const input={kind:'deadline_target',data:{project_id:project.id,deadline_id:deadline.id,status:'suggested'},idempotency_key:'target-first'};
  const first=await writeRecord(owner,input);
  assert.equal((await writeRecord(owner,input)).id,first.id);
  const duplicate={...input,idempotency_key:'target-duplicate'};
  await assert.rejects(writeRecord(owner,duplicate),e=>e.status===409&&e.code==='target_already_linked');
  await assert.rejects(writeRecord(owner,duplicate),e=>e.code==='target_already_linked');
  const updated=await writeRecord(owner,{id:first.id,data:{...first.data,status:'tentative'},expected_revision:first.revision},'update');
  assert.equal(updated.data.status,'tentative');
  const archived=await writeRecord(owner,{id:updated.id,expected_revision:updated.revision},'archive');
  const concurrent=await Promise.all(['target-race-a','target-race-b'].map(idempotency_key=>writeRecord(owner,{...input,idempotency_key}).catch(e=>e)));
  assert.equal(concurrent.filter(r=>r.kind==='deadline_target').length,1);
  assert.equal(concurrent.filter(r=>r.code==='target_already_linked').length,1);
  await assert.rejects(writeRecord(owner,{id:archived.id,expected_revision:archived.revision},'restore'),e=>e.code==='target_already_linked');
  const active=(await listRecords(owner,{kind:'deadline_target'})).records;
  assert.equal(active.length,1);
  assert.equal((await exportData(owner)).audit_events.filter(e=>e.action==='create'&&[first.id,active[0].id].includes(e.record_id)).length,2);
  await writeRecord(owner,{id:active[0].id,expected_revision:active[0].revision},'archive');
  assert.equal((await writeRecord(owner,{id:archived.id,expected_revision:archived.revision},'restore')).deleted_at,null);
});

test('target pair changes are guarded; owners are isolated; existing duplicate history stays editable', async () => {
  const owner='target-change-owner';
  const p=await writeRecord(owner,{kind:'project',data:{name:'Project'}});
  const a=await writeRecord(owner,{kind:'deadline',data:{conference_name:'A',date:'2027-01-01'}});
  const b=await writeRecord(owner,{kind:'deadline',data:{conference_name:'B',date:'2027-02-01'}});
  const first=await writeRecord(owner,{kind:'deadline_target',data:{project_id:p.id,deadline_id:a.id}});
  const second=await writeRecord(owner,{kind:'deadline_target',data:{project_id:p.id,deadline_id:b.id}});
  await assert.rejects(writeRecord(owner,{id:second.id,expected_revision:second.revision,data:{...second.data,deadline_id:a.id}},'update'),e=>e.code==='target_already_linked');
  assert.equal((await getRecord(owner,second.id)).data.deadline_id,b.id);
  // Simulate duplicates already present before this fix: they must not be removed.
  sqlite.prepare("INSERT INTO records(id,user_id,kind,revision,data_json,created_at,updated_at,deleted_at,last_mutation_id) SELECT 'existing-duplicate',user_id,kind,revision,data_json,created_at,updated_at,NULL,'legacy' FROM records WHERE user_id=? AND id=?").run(owner,first.id);
  const revised=await writeRecord(owner,{id:first.id,expected_revision:first.revision,data:{...first.data,notes:'Preserved history',status:'tentative'}},'update');
  assert.equal(revised.data.notes,'Preserved history');
  assert.equal((await getRecord(owner,'existing-duplicate')).deleted_at,null);
  for (const record of [p,a]) await importData('independent-target-owner',{records:[{id:record.id,kind:record.kind,data:record.data}]});
  assert.equal((await writeRecord('independent-target-owner',{kind:'deadline_target',data:{project_id:p.id,deadline_id:a.id}})).kind,'deadline_target');
});

test('imports cannot add duplicate active pairs and racing imports remain bounded', async () => {
  const owner='import-target-owner';
  const p=await writeRecord(owner,{kind:'project',data:{name:'Project'}});
  const d=await writeRecord(owner,{kind:'deadline',data:{conference_name:'Deadline',date:'2027-01-01'}});
  const record=id=>({id,kind:'deadline_target',data:{project_id:p.id,deadline_id:d.id}});
  await assert.rejects(importData(owner,{records:[record('pair-a'),record('pair-b')]}),e=>e.code==='target_already_linked');
  assert.equal((await listRecords(owner,{kind:'deadline_target'})).records.length,0);
  const raced=await Promise.all(['pair-c','pair-d'].map(id=>importData(owner,{records:[record(id)]}).catch(e=>e)));
  assert.equal(raced.filter(r=>r.created===1).length,1);
  assert.equal(raced.filter(r=>r.code==='target_already_linked').length,1);
  const active=(await listRecords(owner,{kind:'deadline_target'})).records;
  assert.equal(active.length,1);
  assert.equal((await importData(owner,{records:[record(active[0].id)]})).skipped,1);
});

test('project merge references require a different active owned project', async () => {
  const owner = 'merge-reference-owner';
  let source = await writeRecord(owner, { kind: 'project', data: { name: 'Source project' } });
  const destination = await writeRecord(owner, { kind: 'project', data: { name: 'Destination project' } });
  const foreign = await writeRecord('other-merge-owner', { kind: 'project', data: { name: 'Private destination' } });
  const person = await writeRecord(owner, { kind: 'student', data: { name: 'Not a project' } });
  const archived = await writeRecord(owner, { kind: 'project', data: { name: 'Archived destination' } });
  await writeRecord(owner, { id: archived.id, expected_revision: archived.revision }, 'archive');
  for (const [merged_into_project_id, status] of [[foreign.id, 404], [person.id, 400], [archived.id, 404], ['missing-merge-project', 404], [source.id, 400]]) {
    await assert.rejects(writeRecord(owner, { id: source.id, expected_revision: source.revision, data: { ...source.data, status: 'Merged', merged_into_project_id } }, 'update'), e => e.status === status);
    assert.equal((await getRecord(owner, source.id)).revision, source.revision);
  }
  await assert.rejects(writeRecord(owner, { id: 'self-merge-create', kind: 'project', data: { name: 'Self', merged_into_project_id: 'self-merge-create' } }), e => e.status === 400);
  await assert.rejects(writeRecord(owner, { kind: 'project', data: { name: 'New source', merged_into_project_id: foreign.id } }), e => e.status === 404);
  source = await writeRecord(owner, { id: source.id, expected_revision: source.revision, data: { ...source.data, status: 'Merged', merged_into_project_id: destination.id } }, 'update');
  assert.equal(source.data.merged_into_project_id, destination.id);
  const created = await writeRecord(owner, { kind: 'project', data: { name: 'Another source', status: 'Merged', merged_into_project_id: destination.id } });
  assert.equal(created.data.merged_into_project_id, destination.id);
});

test('merging preserves source relationships and submission history without transferring or inventing records', async () => {
  const owner = 'merge-preservation-owner';
  const deadline = await writeRecord(owner, { kind: 'deadline', data: { conference_name: 'Original venue', date: '2026-01-01' } });
  let source = await writeRecord(owner, { kind: 'project', data: { name: 'Source', status: 'Done', deadline_id: deadline.id, notes: 'Original notes', links: [{ label: 'Original link', url: 'https://example.org/original' }] } });
  const destination = await writeRecord(owner, { kind: 'project', data: { name: 'Destination', status: 'In Progress', notes: 'Destination notes' } });
  const student = await writeRecord(owner, { kind: 'student', data: { name: 'Source collaborator' } });
  const linked = await setLabLink(owner, { project_id: source.id, student_id: student.id, linked: true });
  source = linked.project;
  const submission = await writeRecord(owner, { kind: 'deadline_target', data: { project_id: source.id, deadline_id: deadline.id, status: 'submitted', outcome: 'rejected' } });
  const before = await exportData(owner);
  source = await writeRecord(owner, { id: source.id, expected_revision: source.revision, data: { ...source.data, status: 'Merged', merged_into_project_id: destination.id } }, 'update');
  assert.equal(source.data.notes, 'Original notes');
  assert.equal(source.data.deadline_id, deadline.id);
  assert.equal(source.data.links[0].url, 'https://example.org/original');
  assert.deepEqual(source.data.connected_students, [student.id]);
  assert.deepEqual((await getRecord(owner, student.id)).data.connected_projects, [source.id]);
  assert.deepEqual(await getRecord(owner, destination.id), destination);
  assert.deepEqual(await getRecord(owner, submission.id), submission);
  const after = await exportData(owner);
  assert.equal(after.records.length, before.records.length);
  assert.deepEqual(after.links, before.links);
  await assert.rejects(writeRecord(owner, { id: source.id, expected_revision: source.revision - 1, data: { ...source.data, notes: 'Stale edit' } }, 'update'), e => e.status === 409);
});

test('unchanged historical merge destinations remain editable while changed references are checked', async () => {
  const owner = 'merge-history-owner';
  await importData(owner, { records: [{ id: 'legacy-merge-source', kind: 'project', data: { name: 'Historical source', status: 'Merged', merged_into_project_id: 'missing-exported-destination' } }] });
  let source = await getRecord(owner, 'legacy-merge-source');
  source = await writeRecord(owner, { id: source.id, expected_revision: source.revision, data: { ...source.data, notes: 'Preserved historical context' } }, 'update');
  assert.equal(source.data.merged_into_project_id, 'missing-exported-destination');
  await assert.rejects(writeRecord(owner, { id: source.id, expected_revision: source.revision, data: { ...source.data, merged_into_project_id: 'different-missing-destination' } }, 'update'), e => e.status === 404);
  const destination = await writeRecord(owner, { kind: 'project', data: { name: 'Known destination' } });
  source = await writeRecord(owner, { id: source.id, expected_revision: source.revision, data: { ...source.data, merged_into_project_id: destination.id } }, 'update');
  await writeRecord(owner, { id: destination.id, expected_revision: destination.revision }, 'archive');
  source = await writeRecord(owner, { id: source.id, expected_revision: source.revision, data: { ...source.data, notes: 'Editable after destination archive' } }, 'update');
  assert.equal(source.data.merged_into_project_id, destination.id);
  const cleared = { ...source.data }; delete cleared.merged_into_project_id;
  source = await writeRecord(owner, { id: source.id, expected_revision: source.revision, data: cleared }, 'update');
  assert.equal(Object.hasOwn(source.data, 'merged_into_project_id'), false);
  assert.equal(source.data.status, 'Merged');
});

test('self-merge imports are rejected before any record is written', async () => {
  const owner = 'self-merge-import-owner';
  await assert.rejects(importData(owner, { records: [{ id: 'valid-before-self', kind: 'project', data: { name: 'Valid' } }, { id: 'self-import', kind: 'project', data: { name: 'Invalid', merged_into_project_id: 'self-import' } }] }), e => e.code === 'invalid_reference');
  assert.equal((await listRecords(owner)).records.length, 0);
});
