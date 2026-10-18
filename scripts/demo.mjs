import fs from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const vars='.dev.vars';
if(fs.existsSync(vars)&&!/^DEMO_MODE\s*=\s*["']?true["']?\s*$/m.test(fs.readFileSync(vars,'utf8'))){
  console.error('This checkout already has private configuration. Run the demo in a fresh clone so your private local data stays separate.');process.exit(1);
}
if(!fs.existsSync(vars))fs.writeFileSync(vars,'DEMO_MODE="true"\nAPP_ORIGIN="http://127.0.0.1:5174"\n',{mode:0o600});
const run=(args)=>{const r=spawnSync(process.execPath,args,{stdio:'inherit',cwd:root});if(r.status!==0)process.exit(r.status||1)};
run(['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','DB','--local','--config','wrangler.jsonc']);
run(['scripts/seed-demo.mjs','--demo']);
console.log('\nPIA fictional demo: http://127.0.0.1:5174\nAll people, projects, and deadline dates are illustrative.\n');
const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{stdio:'inherit',cwd:root});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code||0));
