import type { LabRecord, LabKind, LabData } from '../components/lab/model';

type Link = { project_id: string; student_id: string };
type Snapshot = { records: LabRecord[]; links: Link[] };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const DEMO_STORAGE_KEY = 'pia-public-demo-v1';
const kinds = new Set(['project', 'student', 'deadline', 'deadline_target', 'project_update', 'lab_setting']);

/** Each visitor owns a browser-local sandbox. This adapter never contacts a server. */
export function createBrowserStore(seed: Snapshot, storage: StorageLike) {
  function read(): Snapshot {
    const raw = storage.getItem(DEMO_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Snapshot;
      if (!Array.isArray(parsed.records) || !Array.isArray(parsed.links)) throw new Error('Demo data could not be read. Use Reset demo to start again.');
      return parsed;
    }
    return structuredClone(seed);
  }
  function save(state: Snapshot) {
    try { storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state)); }
    catch { throw new Error('Your browser could not save this demo. Free some browser storage and try again.'); }
  }
  function expanded(record: LabRecord, state: Snapshot): LabRecord {
    const result = structuredClone(record);
    if (record.kind === 'project') result.data.connected_students = state.links.filter(l => l.project_id === record.id && state.records.some(r => r.id === l.student_id && !r.deleted_at)).map(l => l.student_id);
    if (record.kind === 'student') result.data.connected_projects = state.links.filter(l => l.student_id === record.id && state.records.some(r => r.id === l.project_id && !r.deleted_at)).map(l => l.project_id);
    return result;
  }
  function validate(record: LabRecord, state: Snapshot) {
    if (!kinds.has(record.kind)) throw new Error('Unsupported PIA record type.');
    const d = record.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Record details are required.');
    if (['project', 'student'].includes(record.kind) && !String(d.name || '').trim()) throw new Error('Add a name.');
    const reference = (id: unknown, kind: string) => state.records.some(r => r.id === id && r.kind === kind && !r.deleted_at);
    if (['deadline_target', 'project_update'].includes(record.kind) && !reference(d.project_id, 'project')) throw new Error('Choose an active project.');
    if (record.kind === 'deadline_target') {
      if (!reference(d.deadline_id, 'deadline')) throw new Error('Choose an active deadline.');
      if (!['suggested', 'tentative', 'confirmed', 'submitted'].includes(String(d.status))) throw new Error('Choose a submission status.');
      if (d.outcome && (d.status !== 'submitted' || !['pending', 'accepted', 'rejected'].includes(d.outcome))) throw new Error('An outcome needs a submitted target.');
      if (state.records.some(r => r.id !== record.id && !r.deleted_at && r.kind === record.kind && r.data.project_id === d.project_id && r.data.deadline_id === d.deadline_id)) throw new Error('This project already has a target for that deadline.');
    }
    delete d.connected_students; delete d.connected_projects;
  }
  return {
    reset() { storage.removeItem(DEMO_STORAGE_KEY); },
    async request<T>(path: string, options: RequestInit = {}): Promise<T> {
      const url = new URL(path, 'https://demo.invalid');
      const method = (options.method || 'GET').toUpperCase();
      const state = read();
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : {};
      const active = (r: LabRecord) => !r.deleted_at;
      const find = (id: string) => { const r = state.records.find(r => r.id === id); if (!r) throw new Error('Record not found.'); return r; };
      const current = (record: LabRecord) => {
        if (body.expected_revision !== record.revision) throw new Error('This record changed in another tab. Reload it before saving.');
      };
      let result: unknown;
      if (url.pathname === '/api/records' && method === 'GET') {
        const archived = url.searchParams.get('archived') === 'true';
        const records = state.records.filter(r => r.kind === url.searchParams.get('kind') && Boolean(r.deleted_at) === archived).map(r => expanded(r, state));
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0), limit = Math.max(1, Number(url.searchParams.get('limit')) || 2000);
        result = { records: records.slice(offset, offset + limit), has_more: records.length > offset + limit, next_offset: offset + limit };
      } else if (url.pathname === '/api/records' && method === 'POST') {
        const now = new Date().toISOString();
        const record = { id: crypto.randomUUID(), kind: body.kind as LabKind, data: structuredClone(body.data) as LabData, revision: 1, created_at: now, updated_at: now, deleted_at: null };
        validate(record, state); state.records.push(record); save(state); result = { record: expanded(record, state) };
      } else if (url.pathname.startsWith('/api/records/')) {
        const [, , , id, action] = url.pathname.split('/');
        const record = find(id);
        if (method === 'GET') result = { record: expanded(record, state) };
        else {
          current(record);
          if (method === 'PATCH' && !action) { record.data = structuredClone(body.data); validate(record, state); }
          else if (method === 'DELETE' && !action) record.deleted_at = new Date().toISOString();
          else if (method === 'POST' && action === 'restore') record.deleted_at = null;
          else throw new Error('Unsupported demo action.');
          record.revision++; record.updated_at = new Date().toISOString(); save(state); result = { record: expanded(record, state) };
        }
      } else if (url.pathname === '/api/lab/link' && method === 'POST') {
        const project = find(body.project_id), student = find(body.student_id);
        if (project.kind !== 'project' || student.kind !== 'student' || !active(project) || !active(student)) throw new Error('Choose an active project and person.');
        const exists = state.links.some(l => l.project_id === project.id && l.student_id === student.id);
        if (body.linked !== exists) {
          state.links = state.links.filter(l => !(l.project_id === project.id && l.student_id === student.id));
          if (body.linked) state.links.push({ project_id: project.id, student_id: student.id });
          for (const r of [project, student]) { r.revision++; r.updated_at = new Date().toISOString(); }
          save(state);
        }
        result = { project: expanded(project, state), student: expanded(student, state) };
      } else if (url.pathname === '/api/export' && method === 'GET') {
        result = { format: 'private-app-backup', app: 'lab', version: 1, exported_at: new Date().toISOString(), ...state, files: [] };
      } else if (url.pathname === '/api/import' && method === 'POST') {
        if (!Array.isArray(body.records)) throw new Error('Choose a PIA backup.');
        let created = 0, skipped = 0;
        for (const input of body.records) {
          if (state.records.some(r => r.id === input.id)) { skipped++; continue; }
          const record = structuredClone(input) as LabRecord;
          if (typeof record.id !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(record.id)) throw new Error('Invalid record ID.');
          // Validate references after every record has been added, independent of backup ordering.
          state.records.push(record); created++;
        }
        for (const record of state.records) if (!record.deleted_at) validate(record, state);
        if (Array.isArray(body.links)) for (const l of body.links) {
          if (state.records.some(r => r.id === l.project_id && r.kind === 'project') && state.records.some(r => r.id === l.student_id && r.kind === 'student') && !state.links.some(prior => prior.project_id === l.project_id && prior.student_id === l.student_id)) state.links.push({ project_id: l.project_id, student_id: l.student_id });
        }
        save(state); result = { created, skipped };
      } else if (url.pathname === '/api/files') throw new Error('File uploads are available in your own PIA deployment. Add a link to try attachments in this demo.');
      else throw new Error('This action is available in your own PIA deployment.');
      return structuredClone(result) as T;
    },
  };
}
