import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {build} from 'esbuild';
const root=new URL('../',import.meta.url);
const migration=readFileSync(new URL('apps/type3-worker/migrations/0001_research.sql',root),'utf8');
writeFileSync(new URL('apps/type3-worker/src/schema.generated.ts',root),`// Generated from migrations/0001_research.sql; do not edit.\nexport const MIGRATION=${JSON.stringify(migration)};\n`);
mkdirSync(new URL('apps/type3-worker/dist/',root),{recursive:true});
await build({absWorkingDir:root.pathname,entryPoints:['apps/type3-worker/src/index.ts'],bundle:true,platform:'browser',format:'esm',target:'es2022',outfile:'apps/type3-worker/dist/index.mjs'});
