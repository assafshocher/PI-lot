import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-global-search-'));
for (const name of ['model', 'global-search']) {
  const source = fs.readFileSync(new URL(`./${name}.ts`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll('from "./model"', 'from "./model.mjs"');
  fs.writeFileSync(path.join(folder, `${name}.mjs`), output);
}
const { buildSearchIndex, searchLab, normalizeSearch } = await import(pathToFileURL(path.join(folder, 'global-search.mjs')));
after(() => fs.rmSync(folder, { recursive: true, force: true }));
const r = (kind, id, data, extra = {}) => ({ kind, id, data, revision: 1, created_at: '', updated_at: '', ...extra });
const state = (extra = {}) => ({ students: [], projects: [], deadlines: [], targets: [], updates: [], settings: [], ...extra });
const ids = (groups) => groups.flatMap(group => group.results.map(result => result.record.id));

test('search covers all entity groups regardless of default views and returns original records', () => {
  const s = state({ students: [r('student', 'prospect', { name: 'Vision researcher', lab_status: 'Candidate' })], projects: [r('project', 'canceled', { name: 'Vision study', status: 'Canceled' })], deadlines: [r('deadline', 'past', { conference_name: 'Vision 2000', date: '2000-01-01' })] });
  const results = searchLab(buildSearchIndex(s), 'vision');
  assert.deepEqual(results.map(group => group.label), ['People', 'Projects', 'Deadlines']);
  assert.deepEqual(ids(results), ['prospect', 'canceled', 'past']);
  assert.equal(results[0].results[0].record, s.students[0]);
});
test('empty queries do not dump all private records into the dropdown', () => {
  assert.deepEqual(searchLab(buildSearchIndex(state({ projects: [r('project', 'a', { name: 'Alpha' })] })), '   '), []);
});
test('names rank ahead of note matches with stable ordering', () => {
  const index = buildSearchIndex(state({ projects: [r('project', 'note', { name: 'A research project', notes: 'alpha evidence' }), r('project', 'prefix', { name: 'Alpha Beta' }), r('project', 'exact', { name: 'Alpha' })] }));
  assert.deepEqual(ids(searchLab(index, 'alpha')), ['exact', 'prefix', 'note']);
  assert.equal(searchLab(index, 'alpha')[0].results[2].matchedInNotes, true);
  assert.deepEqual(ids(searchLab([...index].reverse(), 'alpha')), ['exact', 'prefix', 'note']);
});
test('all query words are required, with case, accents and Hebrew handled', () => {
  const index = buildSearchIndex(state({ students: [r('student', 'a', { name: 'José Cohen', notes: 'Vision researcher' }), r('student', 'b', { name: 'נֹעַם לוי', notes: 'Image geometry' })] }));
  assert.deepEqual(ids(searchLab(index, 'JOSE vision')), ['a']);
  assert.deepEqual(ids(searchLab(index, 'jose missing')), []);
  assert.deepEqual(ids(searchLab(index, 'נעם geometry')), ['b']);
  assert.equal(normalizeSearch('  José  COHEN  '), 'jose cohen');
});
test('person aliases are searchable while results use the updated membership labels', () => {
  const index = buildSearchIndex(state({ students: [r('student', 'prospect', { name: 'Amy', lab_status: 'Candidate', degree: 'MSc' }), r('student', 'working', { name: 'Ben', lab_status: 'Active Candidate', degree: 'PhD' })] }));
  assert.deepEqual(ids(searchLab(index, 'prospective MSc')), ['prospect']);
  assert.deepEqual(ids(searchLab(index, 'project candidate')), ['working']);
  assert.match(searchLab(index, 'Amy')[0].results[0].subtitle, /Prospective/);
  assert.match(searchLab(index, 'Ben')[0].results[0].subtitle, /Project candidate/);
});
test('topics, cycle, descriptions, notes and role fields are indexed without rendering provenance', () => {
  const index = buildSearchIndex(state({ deadlines: [r('deadline', 'venue', { conference_name: 'Annual meeting', venue: 'CVPR', cycle: '2027', topics: ['computer vision'], notes: 'Submission guidance', date_status: 'tba', source_url: 'https://example.org/private-evidence' })], projects: [r('project', 'paper', { name: 'Paper', title: 'Alternate title', description: 'Neural geometry', status: 'Done + submitted' })] }));
  assert.deepEqual(ids(searchLab(index, 'CVPR 2027 computer')), ['venue']);
  assert.deepEqual(ids(searchLab(index, 'neural submitted')), ['paper']);
  assert.deepEqual(ids(searchLab(index, 'alternate')), ['paper']);
  assert.equal(ids(searchLab(index, 'private-evidence')).length, 0);
  assert.equal(searchLab(index, 'CVPR')[0].results[0].subtitle, 'Full paper · Date TBA');
});
test('archived records are excluded and duplicate pages do not duplicate results', () => {
  const active = r('project', 'same', { name: 'Alpha' });
  const index = buildSearchIndex(state({ projects: [active, active, r('project', 'archived', { name: 'Alpha old' }, { deleted_at: '2026-01-01' })] }));
  assert.deepEqual(ids(searchLab(index, 'alpha')), ['same']);
});
test('search retains every match for the UI show-all control', () => {
  const index = buildSearchIndex(state({ projects: Array.from({ length: 40 }, (_, i) => r('project', `p${i}`, { name: `Study ${i}` })) }));
  const results = searchLab(index, 'study');
  assert.equal(results[0].results.length, 40);
  assert.equal(new Set(ids(results)).size, 40);
});
