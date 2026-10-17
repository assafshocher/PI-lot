import test from 'node:test';
import { withTrustedAuth } from './auth-context.ts';
import assert from 'node:assert/strict';
import { AppError, calculateNutrition, normalizeData, parse, ingredientSchema, requestIdentity, checkOrigin, dateSchema, updateSchema } from './domain.ts';

const ingredient = input => parse(ingredientSchema, { name: 'Test food', quantity: 1, unit: 'serving', basis: 'total', ...input });
test('unknown nutrients remain unknown while known zero remains measured zero', () => {
  const result = calculateNutrition([ingredient({ nutrients: { calories: 200, protein: 0 } }), ingredient({ nutrients: { calories: 50 } })]);
  assert.equal(result.totals.calories, 250); assert.equal(result.totals.protein, null); assert.equal(result.known_totals.protein, 0);
  assert.deepEqual(result.completeness.protein, { known: 1, total: 2 }); assert.equal(result.totals.omega3, null);
});
test('serving and per-100g values scale once, subsets do not add to macros', () => {
  const result = calculateNutrition([
    ingredient({ basis: 'per_100g', grams: 150, nutrients: { calories: 100, carbs: 10, sugar: 4, added_sugar: 1, fat: 8, unsaturated_fat: 6, omega3: 1 } }),
    ingredient({ basis: 'per_serving', quantity: 2, nutrients: { calories: 50, carbs: 5, sugar: 1, added_sugar: 0, fat: 2, unsaturated_fat: 1, omega3: 0 } })
  ]);
  assert.equal(result.totals.calories, 250); assert.equal(result.totals.carbs, 25); assert.equal(result.totals.fat, 16); assert.equal(result.totals.omega3, 1.5);
});
test('impossible nutrient components, negative values and missing grams are rejected', () => {
  for (const input of [{ basis: 'per_100g', nutrients: {} }, { nutrients: { protein: -1 } }, { nutrients: { fat: 4, saturated_fat: 3, unsaturated_fat: 3 } }, { nutrients: { carbs: 2, sugar: 3 } }, { nutrients: { omega3: 2, unsaturated_fat: 1 } }]) assert.throws(() => ingredient(input), AppError);
});
test('server recalculates supplied totals and derives local meal date', () => {
  const data = normalizeData('meal', { name: 'Late meal', consumed_at: '2026-10-17T22:30:00Z', timezone: 'Asia/Jerusalem', ingredients: [ingredient({ nutrients: { calories: 123 } })], totals: { calories: 9999 } });
  assert.equal(data.date, '2026-10-18'); assert.equal(data.totals.calories, 123); assert.equal(data.totals.protein, null);
});
test('invalid dates and timezones are rejected', () => {
  assert.throws(() => parse(dateSchema, '2026-02-30'), AppError);
  assert.throws(() => normalizeData('meal', { name: 'Meal', consumed_at: '2026-10-17T12:00:00Z', timezone: 'Never/Exists', ingredients: [ingredient({})] }), AppError);
});
test('unannounced deadline remains TBA without a fabricated date', () => {
  const deadline = normalizeData('deadline', { conference_name: 'Future conference', date_status: 'tba', date: '', time: '23:59' });
  assert.equal(deadline.date, null); assert.equal(deadline.time, undefined); assert.equal(deadline.date_status, 'tba');
  assert.throws(() => normalizeData('deadline', { conference_name: 'Future conference', date_status: 'confirmed' }), AppError);
});
test('submission targets preserve explicit submitted history and existing planning states', () => {
  const input = { project_id: 'project-1', deadline_id: 'deadline-1', notes: 'Paper sent; decision pending.', source_url: 'https://example.org/submission/123', verified_at: '2026-10-17T12:00:00Z' };
  for (const status of ['suggested', 'tentative', 'confirmed', 'submitted']) {
    const result = normalizeData('deadline_target', { ...input, status });
    assert.equal(result.status, status);
    for (const field of ['project_id', 'deadline_id', 'notes', 'source_url', 'verified_at']) assert.equal(result[field], input[field]);
  }
  assert.equal(normalizeData('deadline_target', input).status, 'suggested');
});
test('submission targets reject unsupported statuses instead of treating them as submissions', () => {
  for (const status of ['accepted', 'rejected', 'Submitted', 'submit', '', null, 1]) {
    assert.throws(() => normalizeData('deadline_target', { project_id: 'project-1', deadline_id: 'deadline-1', status }), AppError);
  }
});
test('submitted decisions roundtrip without implying a decision for older records', () => {
  const input = { project_id: 'project-1', deadline_id: 'deadline-1', status: 'submitted', notes: 'Decision recorded from the author.', confidence: 'high', source_url: 'https://example.org/submission/123' };
  for (const outcome of ['pending', 'accepted', 'rejected']) {
    const normalized = normalizeData('deadline_target', { ...input, outcome });
    assert.equal(normalized.outcome, outcome);
    assert.equal(normalized.status, 'submitted');
    assert.deepEqual(normalizeData('deadline_target', JSON.parse(JSON.stringify(normalized))), normalized);
    assert.equal(normalized.notes, input.notes);
    assert.equal(normalized.source_url, input.source_url);
  }
  const historical = normalizeData('deadline_target', input);
  assert.equal(Object.hasOwn(historical, 'outcome'), false);
  assert.equal(Object.hasOwn(normalizeData('deadline_target', historical), 'outcome'), false);
});
test('decisions require submitted status and reject unsupported values', () => {
  const input = { project_id: 'project-1', deadline_id: 'deadline-1' };
  for (const status of ['suggested', 'tentative', 'confirmed', undefined]) {
    for (const outcome of ['pending', 'accepted', 'rejected']) {
      assert.throws(() => normalizeData('deadline_target', { ...input, status, outcome }), AppError);
    }
  }
  for (const outcome of ['Accepted', 'accept', '', null, 1]) {
    assert.throws(() => normalizeData('deadline_target', { ...input, status: 'submitted', outcome }), AppError);
  }
  const submission = normalizeData('deadline_target', { ...input, status: 'submitted', outcome: 'rejected' });
  assert.throws(() => normalizeData('deadline_target', { ...submission, status: 'tentative' }), AppError);
  const plan = { ...submission, status: 'tentative' };
  delete plan.outcome;
  assert.equal(normalizeData('deadline_target', plan).status, 'tentative');
  assert.equal(Object.hasOwn(normalizeData('deadline_target', plan), 'outcome'), false);
});
test('lab links cannot be overwritten in a generic record update', () => {
  const project = normalizeData('project', { name: 'Study', status: 'A custom phase', connected_students: ['someone'] });
  assert.equal(project.status, 'A custom phase'); assert.equal('connected_students' in project, false);
});
test('project merge destination is optional, preserved and never changes status or other data', () => {
  const input = { name: 'Source project', status: 'Merged', merged_into_project_id: 'destination-project', notes: 'Original context', deadline_id: 'original-deadline', links: [{ label: 'Source', url: 'https://example.org/source' }] };
  const normalized = normalizeData('project', input);
  for (const key of ['name', 'status', 'merged_into_project_id', 'notes', 'deadline_id', 'links']) assert.deepEqual(normalized[key], input[key]);
  assert.deepEqual(normalizeData('project', normalized), normalized);
  assert.equal(Object.hasOwn(normalizeData('project', { name: 'Old project' }), 'merged_into_project_id'), false);
  assert.equal(normalizeData('project', { ...input, status: 'In Progress' }).status, 'In Progress');
  for (const merged_into_project_id of ['', null, 42, 'invalid/id']) {
    assert.throws(() => normalizeData('project', { ...input, merged_into_project_id }), AppError);
  }
});
test('unsafe URLs and oversized fields are rejected', () => {
  assert.throws(() => normalizeData('project', { name: 'Study', links: [{ label: 'x', url: 'javascript:alert(1)' }] }), AppError);
  assert.throws(() => normalizeData('student', { name: 'a'.repeat(241) }), AppError);
});
test('caller-controlled headers and missing trusted identity do not authorize private records', () => {
  for (const headers of [{}, { 'OAI-Sites-Authorization': 'Bearer test' }, { 'oai-authenticated-user-email': 'someone@example.org' }, { 'oai-authenticated-user-id': 'user-123' }]) assert.throws(() => requestIdentity(new Request('https://example.org/api/records', { headers })), e => e.status === 401);
  assert.equal(withTrustedAuth({userId:'owner',method:'oauth'}, () => requestIdentity(new Request('https://example.org/api/records', { headers: { 'oai-authenticated-user-id': 'user-123' } }))), 'owner');
});
test('browser mutation origin checks reject cross-site requests', () => {
  assert.throws(() => checkOrigin(new Request('https://workspace.example/api/records', { headers: { origin: 'https://evil.example' } })), e => e.status === 403);
  assert.throws(() => checkOrigin(new Request('https://workspace.example/api/records', { headers: { 'sec-fetch-site': 'cross-site' } })), e => e.status === 403);
  assert.doesNotThrow(() => checkOrigin(new Request('https://workspace.example/api/records', { headers: { origin: 'https://workspace.example' } })));
});
test('updates require positive integer revisions', () => {
  for (const expected_revision of [undefined, 0, -1, 1.2]) assert.throws(() => parse(updateSchema, { data: {}, expected_revision }), AppError);
  assert.equal(parse(updateSchema, { data: {}, expected_revision: 3 }).expected_revision, 3);
});

test('deadline discovery metadata is preserved without inventing an exact date', () => {
  const input={conference_name:'Next conference',date_status:'tba',venue:'Research venue',cycle:'2027',topics:['vision','learning'],expected_window:{start:'2027-06-01',end:'2027-08-31',basis:'Historical season; official date unannounced'}};
  const result=normalizeData('deadline',input);
  for(const field of ['venue','cycle','topics','expected_window']) assert.deepEqual(result[field],input[field]);
  assert.equal(result.date,null);
  assert.throws(()=>normalizeData('deadline',{...input,topics:Array(31).fill('topic')}),AppError);
});


test('estimated deadline windows preserve uncertainty and reject invalid ranges', () => {
  const expected_window={start:'2027-06-01',end:'2027-08-31',basis:'Prior-year season; unconfirmed'};
  const input={conference_name:'Future conference',date_status:'estimated',date:'',cycle:2027,expected_window};
  const result=normalizeData('deadline',input);
  assert.equal(result.date,null); assert.equal(result.precision,'date'); assert.equal(result.cycle,'2027');
  assert.deepEqual(result.expected_window,expected_window);
  assert.throws(()=>normalizeData('deadline',{...input,date_status:'confirmed'}),AppError);
  for(const window of [{...expected_window,end:'2027-05-31'},{...expected_window,start:'2027-02-30'},{...expected_window,basis:''}]) assert.throws(()=>normalizeData('deadline',{...input,expected_window:window}),AppError);
});


test('date-only deadlines preserve unknown timezone without inventing AoE', () => {
  for(const timezone of ['unknown','',null]) {
    const result=normalizeData('deadline',{conference_name:'Official date',date:'2027-03-01',date_status:'confirmed',timezone});
    assert.equal(result.timezone,'unknown'); assert.equal(result.date,'2027-03-01');
  }
  for(const data of [{timezone:'unknown',time:'23:59'},{timezone:'Asia/Jerusalem'}]) assert.throws(()=>normalizeData('deadline',{conference_name:'Official date',date:'2027-03-01',precision:'time',...data}),AppError);
  assert.equal(normalizeData('deadline',{conference_name:'Official time',date:'2027-03-01',precision:'time',time:'23:59',timezone:'AoE'}).timezone,'Etc/GMT+12');
});
