import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const ignored=new Set(['node_modules','.git','.wrangler','dist','work','outputs']);
const files=[];
function walk(folder){for(const e of fs.readdirSync(folder,{withFileTypes:true})){if(ignored.has(e.name)||e.name==='.dev.vars'||e.name.startsWith('.env')||e.name.endsWith('.tsbuildinfo'))continue;const p=path.join(folder,e.name);if(e.isDirectory())walk(p);else files.push(p)}}
walk(root);
const errors=[];
for(const file of files){const rel=path.relative(root,file);if(/\.(?:png|jpe?g|mp4|woff2?|ttf)$/.test(file))continue;const text=fs.readFileSync(file,'utf8');
 if(/appgprj_[a-z0-9]+|sunlit-seed-[a-z0-9]+|app\.slack\.com\/client\/[A-Z0-9]+\/[A-Z0-9]+/.test(text))errors.push(`${rel}: private hosting or Slack identity`);
 if(/(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_]{20,}/.test(text))errors.push(`${rel}: credential-like value`);
}
const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
if(config.vars?.DEMO_MODE==='true')errors.push('wrangler.jsonc must never enable demo access');
if(config.assets?.run_worker_first!==true)errors.push('worker must handle every request before assets');
if(!fs.readFileSync('.gitignore','utf8').includes('.dev.vars'))errors.push('local secrets must be ignored');
for(const p of ['README.md','LICENSE','SECURITY.md','docs/deployment.md','docs/ai-connection.md'])if(!fs.existsSync(p))errors.push(`Missing ${p}`);
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`Release checks passed (${files.length} files): no private hosting identities or credential-like values; production gate and documentation present.`);
