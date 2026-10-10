import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Only local Wrangler/D1 state and generated synthetic demo credentials are used.
const base='http://127.0.0.1:9876';
const worker=spawn(process.execPath,[
  'node_modules/wrangler/bin/wrangler.js','dev',
  '--config','apps/worker/wrangler.jsonc','--local','--ip','127.0.0.1','--port','9876',
],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
const exited=new Promise(resolve=>worker.once('exit',resolve));
try {
  let ready=false;
  for (let i=0;i<60;i++) {
    if (worker.exitCode!==null) throw new Error(`Wrangler exited with ${worker.exitCode}`);
    const response=await fetch(`${base}/healthz`,{signal:AbortSignal.timeout(1000)}).catch(()=>null);
    if (response?.ok) {ready=true;break;}
    await delay(500);
  }
  assert.ok(ready,'Local workerd did not become healthy within 30 seconds');
  const demo=spawn(process.execPath,['scripts/demo.mjs'],{
    stdio:'inherit',env:{...process.env,HOSPITAL_URL:base},
  });
  const code=await new Promise(resolve=>demo.once('exit',resolve));
  assert.equal(code,0,'Synthetic live Worker demo failed');
} finally {
  worker.kill('SIGTERM');
  await Promise.race([exited,delay(5000)]);
  if (worker.exitCode===null) worker.kill('SIGKILL');
}
