import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
const temp=await mkdtemp(join(tmpdir(),'legacy-import-test-'));
const source=await readFile(new URL('./legacy-import.ts',import.meta.url),'utf8');
const workspaceSource=await readFile(new URL('./workspace.ts',import.meta.url),'utf8');
const workspaceJs=ts.transpileModule(workspaceSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace('from "./domain"','from "'+new URL('./domain.ts',import.meta.url).href+'"').replace(/export const WORKSPACE_KIND = "(?:all|lab|nutri)";/,'export const WORKSPACE_KIND = "all";');
await writeFile(join(temp,'workspace.mjs'),workspaceJs);
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace('from "./domain"','from "'+new URL('./domain.ts',import.meta.url).href+'"').replace('from "./workspace"','from "./workspace.mjs"');
await writeFile(join(temp,'converter.mjs'),js);
const {prepareImport}=await import(pathToFileURL(join(temp,'converter.mjs')).href);
after(()=>rm(temp,{recursive:true,force:true}));

test('historical aggregate preserves date, zeros, unknowns and original provenance',async()=>{
 const row={id:'old-meal',meal_name:'Historical meal',date:'2026-01-05',calories:420,protein:0,notes:'Original note'};
 const result=await prepareImport({NutritionLog:[row]});
 assert.equal(result.can_import,true);const data=result.records[0].data;
 assert.equal(data.date,'2026-01-05');assert.equal(data.consumed_at,null);assert.equal(data.time_precision,'date');
 assert.equal(data.totals.calories,420);assert.equal(data.totals.protein,0);assert.equal(data.totals.fiber,null);
 assert.equal(data.ingredients.length,1);assert.equal(data.ingredients[0].basis,'total');
 assert.deepEqual(data.import_provenance.original_record,row);assert.ok(data.notes.includes('Original note'));
});
test('saved dish aggregate has one original serving without inventing ingredients',async()=>{
 const result=await prepareImport([{id:'dish-one',name:'Original dish',serving_size:'1 cup',calories:300,fat:12}],{entity:'SavedDish'});
 assert.equal(result.can_import,true);assert.equal(result.records[0].data.servings,1);
 assert.equal(result.records[0].data.ingredients[0].unit,'1 cup');assert.equal(result.records[0].data.totals.saturated_fat,null);
});
test('impossible original nutrient relations stop import and are never silently repaired',async()=>{
 const result=await prepareImport({NutritionLog:[{id:'bad-meal',meal_name:'Historical error',date:'2026-01-05',calories:100,carbs:4,sugar:10}]});
 assert.equal(result.can_import,false);assert.ok(result.issues.some(i=>i.severity==='error'&&i.message.includes('sugar')));
});
test('lab links are deduplicated and survive both legacy relationship arrays',async()=>{
 const result=await prepareImport({projects:[{id:'p',name:'A project',connected_students:['s']}],students:[{id:'s',name:'A student',connected_projects:['p']}],deadlines:[{id:'d',conference_name:'Future conference'}]});
 assert.equal(result.can_import,true);assert.deepEqual(result.links,[{project_id:'p',student_id:'s'}]);
 assert.equal(result.records.find(r=>r.kind==='deadline').data.date,null);
 assert.equal(result.records.find(r=>r.kind==='deadline').data.date_status,'tba');
});
test('missing IDs are stable across previews and can retain links',async()=>{
 const input={Project:[{name:'No original id',connected_students:['s']}],Student:[{id:'s',name:'Student'}]};
 const a=await prepareImport(input),b=await prepareImport(input);
 assert.equal(a.records[0].id,b.records[0].id);assert.equal(a.links[0].project_id,a.records[0].id);
});
test('native backup roundtrip keeps archived snapshots and relationships',async()=>{
 const input={format:'lab-nutri-workspace',version:1,records:[{id:'p',kind:'project',data:{name:'Archived',connected_students:['s']},deleted_at:'2026-01-01T12:00:00Z'},{id:'s',kind:'student',data:{name:'Student'}}],links:[{project_id:'p',student_id:'s'}]};
 const result=await prepareImport(input);
 assert.equal(result.source,'workspace');assert.equal(result.can_import,true);assert.equal(result.records[0].deleted_at,'2026-01-01T12:00:00.000Z');assert.equal(result.links.length,1);
});
test('duplicates, unknown entities and untyped arrays cannot produce a silent destructive import',async()=>{
 const duplicates=await prepareImport({Project:[{id:'same',name:'One'},{id:'same',name:'Two'}]});assert.equal(duplicates.can_import,false);
 assert.equal((await prepareImport([{id:'one',name:'Unknown'}])).can_import,false);
 const unsupported=await prepareImport({Project:[{id:'p',name:'Known'}],DataBackup:[{id:'b',csv_url:'https://example.org/backup.csv'}]});
 assert.equal(unsupported.can_import,true);assert.ok(unsupported.issues.some(i=>i.message.includes('not supported')));
});
test('historical custom meal types and timezone-less creation metadata are preserved honestly',async()=>{
 const row={id:'legacy-drink',meal_name:'Historical drink',meal_type:'pre_workout_snack',date:'2026-01-01',calories:120,created_date:'2026-01-01T12:00:00.000000'};
 const preview=await prepareImport({NutritionLog:[row]});
 assert.equal(preview.can_import,true);assert.equal(preview.records[0].data.meal_type,'pre_workout_snack');
 assert.equal(preview.records[0].created_at,undefined);assert.equal(preview.records[0].data.import_provenance.original_record.created_date,row.created_date);
 assert.ok(preview.issues.some(i=>i.location==='timestamps'));
});
test('null original degree colors remain null rather than becoming invented colors',async()=>{
 const preview=await prepareImport({LabSettings:[{id:'degree-options',setting_type:'student_degrees',options:[{label:'Ph.D',color:null}]}]});
 assert.equal(preview.can_import,true);assert.equal(preview.records[0].data.options[0].color,null);
});
