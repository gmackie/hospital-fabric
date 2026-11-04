import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));process.chdir(root);
writeFileSync('apps/type3-worker/src/schema.generated.ts',`// Generated from migrations/0001_research.sql; do not edit.\nexport const MIGRATION=${JSON.stringify(readFileSync('apps/type3-worker/migrations/0001_research.sql','utf8'))};\n`);
mkdirSync('.type3-test',{recursive:true});writeFileSync('.type3-test/.gitignore','*\n');writeFileSync('.type3-test/package.json','{"type":"module"}\n');
const tsc=existsSync('node_modules/.bin/tsc')?'node_modules/.bin/tsc':'tsc';
for(const [bin,args] of [[tsc,['-p','apps/type3-worker/tsconfig.core.json']],[process.execPath,['--experimental-sqlite','--test','tests/type3/model.test.mjs','tests/type3/api.test.mjs','tests/type3/hardware.test.mjs']]]){
 const r=spawnSync(bin,args,{stdio:'inherit'});if(r.error)throw r.error;if(r.status!==0)process.exit(r.status??1);
}
console.log('Type 3 core/typecheck/SQLite/API tests passed. This is NOT full runtime, hardware, or clinical validation.');
