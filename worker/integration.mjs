// Runs the real Cloudflare worker and OAuth library against isolated local D1/KV.
// All credentials and records below are fictional test fixtures.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { createHash, randomBytes } from 'node:crypto';

const root=fileURLToPath(new URL('..',import.meta.url));
const directory=await mkdtemp(join(tmpdir(),'pilot-auth-integration-'));
const origin='https://private-workspace.example';
const password='fictional-integration-password-only';
const secret='fictional-integration-session-secret-only-64-characters-long-xxxx';
let worker;
let checks=0;
function ok(value,message){assert.ok(value,message);checks++;}
function status(response,expected,message){assert.equal(response.status,expected,message);checks++;}
try {
  await build({entryPoints:[join(root,'worker/index.ts')],outfile:join(directory,'worker.mjs'),bundle:true,format:'esm',platform:'browser',target:'es2022',external:['cloudflare:workers','node:*'],tsconfig:join(root,'tsconfig.json'),logLevel:'silent'});
  const workerOptions={rootPath:directory,modulesRoot:directory,modules:true,scriptPath:join(directory,'worker.mjs'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat','global_fetch_strictly_public'],d1Databases:['DB'],kvNamespaces:['OAUTH_KV'],bindings:{APP_ORIGIN:origin,OWNER_PASSWORD:password,SESSION_SECRET:secret},serviceBindings:{ASSETS:()=>new Response('<html><body>Test app shell</body></html>',{headers:{'content-type':'text/html'}})}};
  worker=new Miniflare(workerOptions);
  const db=await worker.getD1Database('DB');
  for(const file of ['drizzle/0000_groovy_landau.sql','drizzle/0001_auth.sql']){
    const sql=await readFile(join(root,file),'utf8');
    for(const statement of sql.replaceAll('--> statement-breakpoint','').split(';').map(v=>v.trim()).filter(Boolean))await db.prepare(statement).run();
  }
  const fetch=(path,options={})=>worker.dispatchFetch(origin+path,{redirect:'manual',...options});
  const jar=new Map();
  const absorb=response=>{for(const raw of response.headers.getSetCookie()){const [part]=raw.split(';');const pos=part.indexOf('=');jar.set(part.slice(0,pos),part.slice(pos+1));}return response;};
  const cookie=()=>[...jar].map(([key,value])=>`${key}=${value}`).join('; ');
  const browser=async(path,options={})=>absorb(await fetch(path,{...options,headers:{cookie:cookie(),...options.headers}}));
  const form=(value)=>({method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(value).toString()});
  const hidden=(html,name)=>{const value=html.match(new RegExp(`name="${name}"[^>]*value="([^"]*)"`))?.[1];assert.ok(value,`Missing ${name} field`);return value;};
  const rpc=(name,args={})=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
  const mcp=(token,body)=>fetch('/mcp',{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});

  status(await fetch('/api/records',{headers:{'oai-authenticated-user-id':'owner'}}),401,'forged hosting header denied');
  status(await fetch('/lab'),303,'private page sends anonymous visitor to sign-in');
  const unauthorized=await mcp(null,rpc('workspace_context'));status(unauthorized,401,'MCP requires OAuth');ok(unauthorized.headers.get('www-authenticate')?.includes('oauth-protected-resource'),'OAuth challenge advertises discovery');
  const discovery=await fetch('/.well-known/oauth-authorization-server');status(discovery,200,'OAuth discovery public');const metadata=await discovery.json();ok(metadata.client_id_metadata_document_supported,'CIMD advertised');ok(metadata.code_challenge_methods_supported.includes('S256'),'S256 advertised');

  const login=await browser('/login');status(login,200,'login page');const loginHtml=await login.text();const csrf=hidden(loginHtml,'csrf');
  status(await browser('/login',{...form({password,csrf,next:'/lab'}),headers:{origin:'https://attacker.example','content-type':'application/x-www-form-urlencoded'}}),403,'cross-origin login denied');
  const signedIn=await browser('/login',form({password,csrf,next:'/lab'}));status(signedIn,303,'correct login accepted');ok(signedIn.headers.getSetCookie().some(c=>c.startsWith('__Host-pilot-session=')&&c.includes('HttpOnly')&&c.includes('Secure')),'secure HttpOnly session cookie');
  const me=await browser('/api/me');status(me,200,'session identity');const account=await me.json();assert.equal(account.user_id,'owner');ok(account.csrf_token,'CSRF token supplied to authenticated UI');
  status(await browser('/api/records',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({kind:'project',data:{name:'No token'}})}),403,'API missing CSRF denied');
  const create=await browser('/api/records',{method:'POST',headers:{origin,'content-type':'application/json','X-CSRF-Token':account.csrf_token},body:JSON.stringify({kind:'project',data:{name:'Fictional security test project',status:'In Progress'},idempotency_key:'integration:browser:create'})});status(create,201,'CSRF-authorized create works');const created=(await create.json()).record;
  status(await browser('/mcp',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(rpc('workspace_context'))}),401,'browser cookie does not authorize MCP');

  async function register(name){
    const response=await fetch('/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({client_name:name,redirect_uris:['https://assistant.example/callback'],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})});
    status(response,201,'dynamic client registration');return response.json();
  }
  async function grant(client,requestedScopes){
    const verifier=randomBytes(32).toString('base64url'),challenge=createHash('sha256').update(verifier).digest('base64url');
    const params=new URLSearchParams({client_id:client.client_id,redirect_uri:'https://assistant.example/callback',response_type:'code',state:'test-state',code_challenge:challenge,code_challenge_method:'S256',resource:origin+'/mcp',scope:requestedScopes.join(' ')});
    const noPkce=new URLSearchParams(params);noPkce.delete('code_challenge');noPkce.delete('code_challenge_method');status(await browser('/authorize?'+noPkce),400,'PKCE required');
    const consent=await browser('/authorize?'+params);status(consent,200,'consent page requires explicit approval');const markup=await consent.text();ok(consent.headers.get('content-security-policy')?.includes("form-action 'self' https://assistant.example"),'consent permits only validated callback origin');ok(markup.includes('assistant.example'),'redirect hostname shown');ok(!markup.includes('<script>alert'),'client metadata escaped');
    const handle=hidden(markup,'handle');
    const consentForm=new URLSearchParams({handle,csrf:account.csrf_token,decision:'approve'});for(const scope of requestedScopes)consentForm.append('scope',scope);
    const approved=await browser('/authorize',{method:'POST',headers:{origin,'content-type':'application/x-www-form-urlencoded'},body:consentForm.toString()});status(approved,303,'consent approved');const callback=new URL(approved.headers.get('location'));assert.equal(callback.origin,'https://assistant.example');assert.equal(callback.searchParams.get('state'),'test-state');ok(callback.searchParams.get('iss')===origin,'authorization response issuer included');
    const wrongAudience=await fetch('/oauth/token',form({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:'https://assistant.example/callback',code:callback.searchParams.get('code'),code_verifier:verifier,resource:'https://another-resource.example/mcp'}));status(wrongAudience,400,'wrong token audience rejected before code consumption');
    const tokenResponse=await fetch('/oauth/token',form({grant_type:'authorization_code',client_id:client.client_id,redirect_uri:'https://assistant.example/callback',code:callback.searchParams.get('code'),code_verifier:verifier,resource:origin+'/mcp'}));status(tokenResponse,200,'PKCE code exchange');return tokenResponse.json();
  }
  const client=await register('<script>alert(1)</script> Fictional assistant');
  const token=await grant(client,['workspace:read','workspace:write','offline_access']);
  ok(token.access_token&&token.refresh_token,'access and refresh tokens issued');
  const read=await mcp(token.access_token,rpc('read_record',{id:created.id}));status(read,200,'OAuth MCP read works');const result=await read.json();ok(JSON.parse(result.result.content[0].text).data.name==='Fictional security test project','MCP and browser share owner workspace');
  const write=await mcp(token.access_token,rpc('upsert_record',{kind:'student',data:{name:'Fictional Student',lab_status:'In Group'},idempotency_key:'integration:oauth:create'}));status(write,200,'OAuth MCP write works');ok(!(await write.json()).result.isError,'write successfully committed');
  const refreshed=await fetch('/oauth/token',form({grant_type:'refresh_token',client_id:client.client_id,refresh_token:token.refresh_token,resource:origin+'/mcp'}));status(refreshed,200,'refresh token exchange');const refreshedToken=await refreshed.json();ok(refreshedToken.access_token&&refreshedToken.refresh_token!==token.refresh_token,'refresh token rotates');
  const reader=await register('Fictional read-only assistant');const readToken=await grant(reader,['workspace:read']);
  status(await mcp(readToken.access_token,rpc('read_record',{id:created.id})),200,'read-only token may read');
  const forbidden=await mcp(readToken.access_token,rpc('upsert_record',{kind:'project',data:{name:'Forbidden'},idempotency_key:'integration:forbidden'}));status(forbidden,403,'read-only token cannot mutate');ok(forbidden.headers.get('www-authenticate')?.includes('workspace:write'),'scope escalation challenge explains missing write access');
  const connections=await browser('/auth/connections');status(connections,200,'grant management page');const connectionsHtml=await connections.text();ok(!connectionsHtml.includes('<script>alert'),'grant names escaped');const grantId=hidden(connectionsHtml,'grant_id');
  const revoke=await browser('/auth/connections',form({csrf:account.csrf_token,grant_id:grantId}));status(revoke,303,'owner revokes grant');
  const remaining=await browser('/auth/connections');ok(!(await remaining.text()).includes(`value="${grantId}"`),'revoked grant no longer listed');
  const responses=await Promise.all([mcp(token.access_token,rpc('workspace_context')),mcp(readToken.access_token,rpc('workspace_context'))]);ok(responses.some(r=>r.status===401),'revocation stops the corresponding token');
  const logout=await browser('/auth/logout',form({csrf:account.csrf_token}));status(logout,303,'logout clears session');status(await browser('/api/me'),401,'logged-out session cannot read');
  const secondLogin=await browser('/login');const secondCsrf=hidden(await secondLogin.text(),'csrf');status(await browser('/login',form({password,csrf:secondCsrf,next:'/lab'})),303,'second browser session established');
  status(await browser('/api/me'),200,'browser session active before rotation');
  await worker.setOptions({...workerOptions,bindings:{...workerOptions.bindings,SESSION_SECRET:'rotated-fictional-integration-secret-64-chars-xxxxxxxxxxxxxxxxxxxx'}});
  status(await browser('/api/me'),401,'rotating session secret invalidates existing browser sessions');
  status(await mcp(refreshedToken.access_token,rpc('workspace_context')),401,'rotating session secret invalidates existing OAuth access');
  status(await mcp(readToken.access_token,rpc('workspace_context')),401,'rotation invalidates every connected assistant');
  console.log(`PASS: ${checks} real-worker OAuth/session/CSRF checks; isolated fictional D1/KV removed.`);
} finally {await worker?.dispose();await rm(directory,{recursive:true,force:true});}
