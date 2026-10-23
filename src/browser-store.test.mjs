import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../demo/fictional-lab.json' with { type: 'json' };
import { createBrowserStore, DEMO_STORAGE_KEY } from './browser-store.ts';
function sandbox() { const values = new Map(); const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; return { store: createBrowserStore(fixture, storage), storage }; }
const write = (data, method = 'POST') => ({ method, body: JSON.stringify(data) });
test('fictional sample, relationships, visitor isolation, persistence and reset', async () => {
  const a = sandbox(), b = sandbox();
  const { records } = await a.store.request('/api/records?kind=project');
  assert.equal(records.length, 12); assert.ok(records.some(r => r.data.connected_students.length));
  const original = records[0];
  await a.store.request(`/api/records/${original.id}`, write({ data: { ...original.data, name: 'Edited locally' }, expected_revision: 1 }, 'PATCH'));
  assert.equal((await createBrowserStore(fixture, a.storage).request(`/api/records/${original.id}`)).record.data.name, 'Edited locally');
  assert.equal((await b.store.request(`/api/records/${original.id}`)).record.data.name, original.data.name);
  await assert.rejects(a.store.request(`/api/records/${original.id}`, write({ data: original.data, expected_revision: 1 }, 'PATCH')), /another tab/);
  a.store.reset(); assert.equal(a.storage.getItem(DEMO_STORAGE_KEY), null);
  assert.equal((await a.store.request(`/api/records/${original.id}`)).record.data.name, original.data.name);
});
test('create, link, archive, restore, export and import preserve records and relationships', async () => {
  const { store } = sandbox();
  const { record: person } = await store.request('/api/records', write({ kind: 'student', data: { name: 'Demo Person' } }));
  const { records: projects } = await store.request('/api/records?kind=project');
  const project = projects[0];
  const linked = await store.request('/api/lab/link', write({ project_id: project.id, student_id: person.id, linked: true }));
  assert.ok(linked.project.data.connected_students.includes(person.id)); assert.ok(linked.student.data.connected_projects.includes(project.id));
  await store.request(`/api/records/${person.id}`, write({ expected_revision: linked.student.revision }, 'DELETE'));
  assert.ok((await store.request('/api/records?kind=student&archived=true')).records.some(r => r.id === person.id));
  assert.ok(!(await store.request(`/api/records/${project.id}`)).record.data.connected_students.includes(person.id));
  await store.request(`/api/records/${person.id}/restore`, write({ expected_revision: 3 }));
  assert.ok((await store.request(`/api/records/${project.id}`)).record.data.connected_students.includes(person.id));
  const backup = await store.request('/api/export');
  const fresh = sandbox();
  const imported = await fresh.store.request('/api/import', write(backup));
  assert.equal(imported.created, 1); assert.equal(imported.skipped, fixture.records.length);
  assert.ok((await fresh.store.request(`/api/records/${project.id}`)).record.data.connected_students.includes(person.id));
});
test('failed imports and storage failures never report a successful save', async () => {
  const { store, storage } = sandbox();
  await assert.rejects(store.request('/api/import', write({ records: [{ id: 'invalid', kind: 'deadline_target', data: { project_id: 'missing' } }] })), /active project/);
  assert.equal(storage.getItem(DEMO_STORAGE_KEY), null);
  const broken = createBrowserStore(fixture, { ...storage, setItem() { throw new Error('Quota'); } });
  await assert.rejects(broken.request('/api/records', write({ kind: 'student', data: { name: 'Demo Person' } })), /could not save/);
  await assert.rejects(store.request('/api/files', { method: 'POST' }), /own PIA deployment/);
});
