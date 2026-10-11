/** Verify the fixed chart round-trip before publishing its bounded public projection. */
import{spawnSync}from'node:child_process';
import{readFileSync}from'node:fs';
const b='/mnt/master-apps/hospital-fabric';
const checked=spawnSync(process.execPath,[b+'/release/deploy/real/hetzner-master/return-lab-result.mjs'],{encoding:'utf8',timeout:60000});
if(checked.status!==0)throw Error('Real workflow verification failed; public proof will become stale');
const record=JSON.parse(readFileSync(b+'/private/lab-order-source.json'));
if(record.returnPhase!=='verified')throw Error('Verified chart return required');
const token=readFileSync(b+'/private/real-demo-bridge.token','utf8').trim();
const response=await fetch('https://med.gmac.io/internal/demo/real-evidence',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({verifiedAt:record.returnEvidence.verifiedAt,value:13.2}),redirect:'error',signal:AbortSignal.timeout(15000)});
if(!response.ok)throw Error('Public proof publication HTTP '+response.status);
console.log('Fixed synthetic real-workflow projection published.');
