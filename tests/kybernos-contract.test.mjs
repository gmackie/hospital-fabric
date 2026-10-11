import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
const bundle=async entry=>{const {outputFiles}=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node'});return import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));};
const {seedHospital,applyCommand,validateHospital}=await bundle('apps/worker/src/hospital/model.ts');
const {stateDigest}=await bundle('apps/worker/src/hospital/canonical.ts');
// Captured by kybernos (examples/twins/hospital_fabric/capture_contract.py) from a live worker.
// A model change that alters any digest must be coordinated with kybernos's transcripts.
const log=JSON.parse(readFileSync('tests/fixtures/kybernos-command-log.json','utf8'));

test('the kybernos command log replays to identical canonical digests',async()=>{
 assert.equal(log.schema,'kybernos-hospital-fabric-contract/v1');assert.equal(log.synthetic,true);
 let s=seedHospital(log.profile);assert.equal(await stateDigest(s),log.initialDigest);
 for(const [i,c] of log.commands.entries()){
  const {stateDigest:expected,...command}=c;
  assert.equal(command.version,i);
  s=applyCommand(s,command);validateHospital(s);
  assert.equal(await stateDigest(s),expected,`command ${c.requestId}`);
 }
 assert.equal(await stateDigest(s),log.finalDigest);
 assert.ok(log.commands.some(c=>c.action==='resupply')&&log.commands.some(c=>c.action==='wan'));
});
