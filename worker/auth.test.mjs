import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { withTrustedAuth, trustedAuth } from '../lib/auth-context.ts';
import { requestIdentity } from '../lib/domain.ts';
import { appContentSecurityPolicy, assertConfigured, authVersion, browserAuth, constantEqual, createSession, demoAllowed, destroySession, loginChallenge, rateLimit, requireCsrf, safeReturnTo, validateLoginChallenge } from './auth.ts';
import { consentPage } from './pages.ts';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(globalThis.authMigration);
  return { prepare(sql) { return { bind(...args) { return { async first() { return sqlite.prepare(sql).get(...args) || null; }, async run() { return sqlite.prepare(sql).run(...args); } }; }, async run() { return sqlite.prepare(sql).run(); } }; }, async batch(statements) { const results=[]; for(const s of statements) results.push(await s.run()); return results; } };
}
globalThis.authMigration = await readFile(new URL('../drizzle/0001_auth.sql', import.meta.url),'utf8');
const environment = () => ({ DB:database(), APP_ORIGIN:'https://lab.example', OWNER_PASSWORD:'fictional-test-only-long-password', SESSION_SECRET:'a'.repeat(64) });
const req = (path='/lab', options={}) => new Request('https://lab.example'+path,options);
const cookies = headers => headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');

test('forged hosting headers never authorize, and async identities cannot bleed between requests', async () => {
  assert.throws(()=>requestIdentity(req('/api/me',{headers:{'oai-authenticated-user-id':'owner'}})),e=>e.status===401);
  const values = await Promise.all(['one','two'].map(userId=>withTrustedAuth({userId,method:'oauth'},async()=>{await new Promise(r=>setTimeout(r,3));return requestIdentity(req());})));
  assert.deepEqual(values,['one','two']); assert.equal(trustedAuth(),undefined);
});
test('production fails closed without strong configuration and enforces canonical HTTPS origin', () => {
  const env=environment(); assert.doesNotThrow(()=>assertConfigured(req(),env));
  for(const change of [{APP_ORIGIN:''},{OWNER_PASSWORD:'short'},{SESSION_SECRET:'short'},{DB:undefined},{APP_ORIGIN:'https://evil.example'},{APP_ORIGIN:'http://lab.example'},{APP_ORIGIN:'https://lab.example/'}]) assert.throws(()=>assertConfigured(req(),{...env,...change}));
});
test('demo opt-in authorizes only explicit loopback URL, never a deployed host or spoofed header', () => {
  for(const hostname of ['localhost','127.0.0.1','[::1]']) assert.equal(demoAllowed(new Request(`http://${hostname}:8787`),{DEMO_MODE:'true'}),true);
  for(const hostname of ['lab.example','localhost.evil.example','127.0.0.1.evil.example']) assert.equal(demoAllowed(new Request(`https://${hostname}`,{headers:{host:'localhost'}}),{DEMO_MODE:'true'}),false);
  assert.equal(demoAllowed(new Request('http://localhost'),{DEMO_MODE:'false'}),false);
});
test('sessions are opaque, HttpOnly, secure, revocable and bound to both secrets', async () => {
  const env=environment(), headers=await createSession(req(),env), cookie=cookies(headers);
  assert.match(headers.getSetCookie()[0],/HttpOnly; SameSite=Lax; Max-Age=28800; Secure/);
  assert.match(cookie,/__Host-pilot-session=/);
  const request=req('/api/me',{headers:{cookie}}), auth=await browserAuth(request,env);
  assert.equal(auth.userId,'owner'); assert.equal(auth.method,'session'); assert.equal(auth.csrfToken.length,43);
  assert.equal(await browserAuth(req(),env),null);
  assert.equal(await browserAuth(req('/api/me',{headers:{cookie:cookie.replace('session=','session=x')}}),env),null);
  assert.equal(await browserAuth(request,{...env,OWNER_PASSWORD:'different-strong-password'}),null);
  assert.equal(await browserAuth(request,{...env,SESSION_SECRET:'b'.repeat(64)}),null);
  assert.match(await destroySession(request,env),/Max-Age=0/); assert.equal(await browserAuth(request,env),null);
});
test('expired sessions cannot authorize', async () => {
  const env=environment(), headers=await createSession(req(),env);
  await env.DB.prepare('UPDATE auth_sessions SET expires_at=0').run();
  assert.equal(await browserAuth(req('/',{headers:{cookie:cookies(headers)}}),env),null);
});
test('session mutations require matching CSRF plus exact Origin, even for form uploads', () => {
  const auth={userId:'owner',method:'session',csrfToken:'known'};
  for(const headers of [{},{origin:'https://lab.example'},{origin:'https://evil.example','X-CSRF-Token':'known'},{origin:'https://lab.example','X-CSRF-Token':'wrong'},{origin:'https://lab.example','X-CSRF-Token':'known','sec-fetch-site':'cross-site'}]) assert.throws(()=>requireCsrf(req('/api/files',{method:'POST',headers}),auth),e=>e.status===403);
  assert.doesNotThrow(()=>requireCsrf(req('/api/files',{method:'POST',headers:{origin:'https://lab.example','X-CSRF-Token':'known'}}),auth));
});
test('login form is browser-bound, signed and cross-origin resistant', async () => {
  const env=environment(), challenge=await loginChallenge(req('/login'),env);
  const request=req('/login',{method:'POST',headers:{origin:'https://lab.example',cookie:challenge.cookie.split(';')[0]}});
  await validateLoginChallenge(request,env,challenge.token);
  await assert.rejects(validateLoginChallenge(request,env,challenge.token+'x'),e=>e.status===403);
  await assert.rejects(validateLoginChallenge(req('/login',{method:'POST',headers:{origin:'https://evil.example',cookie:challenge.cookie}}),env,challenge.token),e=>e.status===403);
  await assert.rejects(validateLoginChallenge(request,{...env,SESSION_SECRET:'b'.repeat(64)},challenge.token),e=>e.status===403);
});
test('atomic per-address and global limits bound password attempts', async () => {
  const env=environment();
  for(let i=0;i<3;i++) await rateLimit(req('/login'),env,'unit',3,10);
  await assert.rejects(rateLimit(req('/login'),env,'unit',3,10),e=>e.status===429);
  const env2=environment();
  for(let i=0;i<2;i++) await rateLimit(req('/login',{headers:{'CF-Connecting-IP':`192.0.2.${i}`}}),env2,'global',10,2);
  await assert.rejects(rateLimit(req('/login',{headers:{'CF-Connecting-IP':'192.0.2.3'}}),env2,'global',10,2),e=>e.status===429);
});
test('credential rotation invalidates the version embedded in AI grants', async () => {
  const env=environment(), version=await authVersion(env);
  assert.notEqual(version,await authVersion({...env,OWNER_PASSWORD:'replacement-password-long'}));
  assert.notEqual(version,await authVersion({...env,SESSION_SECRET:'b'.repeat(64)}));
  assert.equal(await constantEqual('same','same'),true); assert.equal(await constantEqual('same','different'),false);
});
test('return paths cannot redirect login to another origin', () => {
  for(const path of ['https://evil.example','//evil.example','/\\evil.example','/\n/evil.example']) assert.equal(safeReturnTo(path),'/lab');
  assert.equal(safeReturnTo('/authorize?client_id=x&state=y'),'/authorize?client_id=x&state=y');
});
test('consent escapes untrusted metadata and exposes redirect destination and scopes', () => {
  const markup=consentPage({clientName:'<script>alert(1)</script>',clientDomain:'example.org',redirectHost:'localhost',redirectIsLoopback:true,scope:['workspace:read','workspace:write']},'handle','csrf');
  assert.ok(!markup.includes('<script>'));assert.match(markup,/&#60;script&#62;/);assert.match(markup,/localhost/);assert.match(markup,/workspace:write/);assert.match(markup,/app on your computer/);
});

test('private loopback development permits Vite refresh while every deployed host keeps strict script CSP', () => {
  for (const host of ['localhost','127.0.0.1','[::1]']) {
    const policy=appContentSecurityPolicy(new Request(`http://${host}:5174/lab`));
    assert.match(policy,/script-src 'self' 'unsafe-inline'/);
    assert.match(policy,/connect-src 'self' ws: wss:/);
  }
  for (const host of ['lab.example','localhost.evil.example','127.0.0.1.evil.example']) {
    const policy=appContentSecurityPolicy(new Request(`https://${host}/lab`, {headers:{host:'localhost','x-forwarded-host':'localhost'}}));
    assert.match(policy,/script-src 'self';/);
    assert.match(policy,/connect-src 'self';/);
  }
});
