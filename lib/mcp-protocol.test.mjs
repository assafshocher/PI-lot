import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { withTrustedAuth } from './auth-context.ts';

const temp = await mkdtemp(join(tmpdir(), 'mcp-protocol-test-'));
const domainURL = new URL('./domain.ts', import.meta.url).href;
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
for (const name of ['data-http', 'workspace']) {
  const source = await readFile(new URL(`./${name}.ts`, import.meta.url), 'utf8');
  await writeFile(join(temp, `${name}.mjs`), compile(source).replace(/from "\.\/domain(?:\.ts)?"/, `from "${domainURL}"`));
}
const calls = [];
globalThis.__mcpProtocolCalls = calls;
await writeFile(join(temp, 'data.mjs'), `
export async function listRecords(user, input) { globalThis.__mcpProtocolCalls.push({user,input}); return {records:[],has_more:false}; }
export async function getRecord(user, id) { globalThis.__mcpProtocolCalls.push({user,id}); return {id,kind:'project',revision:1,data:{name:'Test record'}}; }
export async function setLabLink() { throw new Error('Unexpected mutation'); }
export async function writeRecord() { throw new Error('Unexpected mutation'); }
`);
const routeSource = compile(await readFile(new URL('../app/mcp/route.ts', import.meta.url), 'utf8'))
  .replace('from "zod"', 'from ' + JSON.stringify(import.meta.resolve('zod')))
  .replaceAll('"@/lib/domain"', JSON.stringify(domainURL))
  .replaceAll('"@/lib/mcp-protocol"', JSON.stringify(new URL('./mcp-protocol.ts', import.meta.url).href))
  .replaceAll('"@/lib/data-http"', '"./data-http.mjs"')
  .replaceAll('"@/lib/workspace"', '"./workspace.mjs"')
  .replaceAll('"@/lib/data"', '"./data.mjs"');
await writeFile(join(temp, 'route.mjs'), routeSource);
const { POST: rawPOST, GET } = await import(pathToFileURL(join(temp, 'route.mjs')).href);
const authenticatedRequests = new WeakSet();
const POST = req => authenticatedRequests.has(req) ? withTrustedAuth({userId:'verified-owner',method:'oauth',scopes:['workspace:read','workspace:write']}, () => rawPOST(req)) : rawPOST(req);
after(async () => { delete globalThis.__mcpProtocolCalls; await rm(temp, {recursive:true,force:true}); });
const origin = 'https://lab.example.org';
const request = (body, headers = undefined) => { const req = new Request(origin + '/mcp', {method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)}); if (headers === undefined || headers?.test_trusted_context) authenticatedRequests.add(req); return req; };
const call = (params, extra = {}) => ({jsonrpc:'2.0',id:1,method:'tools/call',params,...extra});

test('standard metadata-bearing tools/call succeeds and only verified request context supplies identity', async () => {
  const response = await POST(request(call({name:'workspace_context',arguments:{},_meta:{progressToken:0,'openai/locale':'en-US','openai/userAgent':'ChatGPT',client:{trace:'test'},user_id:'untrusted-other'}})));
  assert.equal(response.status,200);
  const result = await response.json();
  assert.equal(result.id,1); assert.equal(result.result.isError,false);
  assert.ok(JSON.parse(result.result.content[0].text).field_guide);
  assert.ok(calls.length>0); assert.ok(calls.every(call=>call.user==='verified-owner'));
});
test('omitted arguments and id zero are accepted; metadata never enters tool arguments', async () => {
  const response = await POST(request(call({name:'read_record',arguments:{id:'record-123'},_meta:{progressToken:'token',id:'wrong-id'}},{id:0})));
  assert.equal(response.status,200); assert.equal((await response.json()).id,0);
  assert.deepEqual(calls.at(-1),{user:'verified-owner',id:'record-123'});
  const empty = await POST(request(call({name:'workspace_context',_meta:{}})));
  assert.equal((await empty.json()).result.isError,false);
});
test('tool arguments remain strict and malformed metadata/envelopes do not execute', async () => {
  let before=calls.length;
  const unexpected = await POST(request(call({name:'workspace_context',arguments:{user_id:'other'},_meta:{}})));
  assert.equal((await unexpected.json()).result.isError,true); assert.equal(calls.length,before);
  for(const params of [{name:'workspace_context',arguments:{},_meta:null},{name:'workspace_context',arguments:[],_meta:{}},{name:'workspace_context',_meta:{progressToken:{bad:true}}},{name:'workspace_context',unexpected:true}]) {
    const response=await POST(request(call(params))); assert.equal(response.status,400); assert.equal((await response.json()).error.code,-32602);
  }
  for(const envelope of [{...call({name:'workspace_context'}),id:null},{...call({name:'workspace_context'}),id:undefined},{...call({name:'workspace_context'}),id:1.5},{...call({name:'workspace_context'}),jsonrpc:'1.0'},{...call({name:'workspace_context'}),extra:true}]) {
    const response=await POST(request(envelope)); assert.equal(response.status,400); assert.equal((await response.json()).error.code,-32600);
  }
  assert.equal(calls.length,before);
});
test('anonymous, service bearer and metadata-only identities cannot read private data', async () => {
  const before=calls.length;
  for(const headers of [{},{'OAI-Sites-Authorization':'Bearer test'},{'oai-authenticated-user-email':'test@example.org'},{'oai-authenticated-user-id':'spoofed'}]) {
    const response=await POST(request(call({name:'workspace_context',_meta:{'oai-authenticated-user-id':'spoofed'}}),headers));
    assert.equal(response.status,401); assert.equal((await response.json()).error.code,'sign_in_required');
  }
  assert.equal(calls.length,before);
});
test('foreign origin and cross-site browser requests are blocked; native absent origin is allowed', async () => {
  const before=calls.length;
  for(const headers of [{origin:'https://other.example'},{'sec-fetch-site':'cross-site'}]) {
    const response=await POST(request(call({name:'workspace_context',arguments:{}}),{test_trusted_context:'yes',...headers}));
    assert.equal(response.status,403); assert.equal((await response.json()).error.code,'invalid_origin');
  }
  assert.equal(calls.length,before);
  const same=await POST(request(call({name:'workspace_context'}),{test_trusted_context:'yes',origin}));
  assert.equal(same.status,200);
});
test('initialization, tools discovery and notifications remain data-free and stateless', async () => {
  const before=calls.length;
  for(const method of ['initialize','tools/list','ping']) {
    const response=await POST(request({jsonrpc:'2.0',id:'discovery',method,params:{_meta:{progressToken:'hello'}}},{}));
    assert.equal(response.status,200); assert.equal((await response.json()).id,'discovery');
  }
  const notification=await POST(request({jsonrpc:'2.0',method:'notifications/initialized'},{}));
  assert.equal(notification.status,202); assert.equal(await notification.text(),'');
  assert.equal(calls.length,before);
  assert.equal((await GET()).status,405);
});
test('JSON syntax/body limits and unknown methods have protocol errors without data access', async () => {
  const before=calls.length;
  const malformed=await POST(request('{')); assert.equal((await malformed.json()).error.code,-32700);
  const oversized=await POST(request(call({name:'workspace_context',_meta:{large:'x'.repeat(512*1024)}}))); assert.equal(oversized.status,413);
  const unknown=await POST(request({jsonrpc:'2.0',id:2,method:'unknown'})); assert.equal((await unknown.json()).error.code,-32601);
  assert.equal(calls.length,before);
});

test('assistant field guidance explains explicit project merges without relationship or submission inference', async () => {
  const response = await POST(request(call({ name: 'workspace_context', arguments: {} })));
  const context = JSON.parse((await response.json()).result.content[0].text);
  assert.match(context.field_guide.project, /merged_into_project_id/);
  assert.match(context.field_guide.project, /different active owned project/);
  assert.match(context.field_guide.project, /never transfers relationships or infers submissions/);
  const initialized = await POST(request({ jsonrpc: '2.0', id: 'merge-guidance', method: 'initialize', params: {} }, {}));
  const instructions = (await initialized.json()).result.instructions;
  assert.match(instructions, /merged_into_project_id/);
  assert.match(instructions, /does not transfer people, deadlines, files, updates, or submission history/);
  assert.match(instructions, /Never infer submissions from Merged/);
});
