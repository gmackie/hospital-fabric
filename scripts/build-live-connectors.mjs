/** Build the real connector bundle for the offline private host; no credentials embedded. */
import {build} from 'esbuild';
import {mkdirSync} from 'node:fs';
const out='deploy/real/hetzner-master/dist/live-connectors.mjs';
mkdirSync('deploy/real/hetzner-master/dist',{recursive:true});
await build({stdin:{contents:[
 "export * from './apps/worker/src/adapters/real/fhir-client';",
 "export * from './apps/worker/src/adapters/real/openmrs';",
 "export * from './apps/worker/src/adapters/real/openelis-task';",
 "export * from './apps/worker/src/adapters/real/live-lab';",
 "export * from './apps/worker/src/adapters/real/live-chart';",
 "export * from './apps/worker/src/adapters/real/live-ledger';"
].join('\n'),resolveDir:process.cwd()},bundle:true,format:'esm',platform:'neutral',target:'es2022',outfile:out});
console.log('Compiled private host connector bundle to '+out+' (contains no secrets).');
