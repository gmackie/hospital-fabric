import { readFileSync } from 'node:fs';
const base=process.env.HOSPITAL_URL ?? 'http://127.0.0.1:9876';
const devVars=readFileSync('apps/worker/.dev.vars','utf8');
const secret=devVars.match(/^DEMO_API_KEY=(.+)$/m)?.[1]?.trim();
if (!secret) throw new Error('Missing dev token; run npm run dev:secrets first');
const request=async(method,path,body)=>{
  const response=await fetch(`${base}${path}`,{
    method,headers:{'x-demo-token':secret,'content-type':'application/json'},
    body:body===undefined?undefined:JSON.stringify(body)
  });
  const result=await response.json();
  if (!response.ok) throw new Error(`${method} ${path} ${response.status}: ${JSON.stringify(result)}`);
  return result;
};
const label=`SYNTHETIC-DEMO-${Date.now()}`;
await request('POST','/v1/admin/bootstrap');
const patient=await request('POST','/v1/demo/patients',{label});
const created=await request('POST','/v1/demo/lab-orders',{
  patientId:patient.id,testCode:'CBC',requestId:`synthetic-${Date.now()}`,
});
console.log('Patient registered:',patient.id);
console.log('Order queued:',created.operationId);
await request('POST','/v1/demo/faults/drop-next-ack');
console.log('Fault armed: next simulated LIS response will be lost after commit.');
console.log('First dispatch:',JSON.stringify(await request('POST','/v1/admin/tick')));
console.log('State:',(await request('GET',`/v1/operations/${created.operationId}`)).operation.state);
console.log('Recovery:',JSON.stringify(await request('POST',`/v1/operations/${created.operationId}/reconcile`)));
await request('POST',`/v1/demo/lis/orders/${created.operationId}/release`,{
  resultText:'SYNTHETIC: 7.5',unitCode:'10^9/L',
});
await request('POST','/v1/admin/tick');
const patientResults=await request('GET',`/v1/demo/patients/${patient.id}/results`);
console.log('Simulated chart results:',JSON.stringify(patientResults,null,2));
const op=await request('GET',`/v1/operations/${created.operationId}`);
console.log('Final operation state:',op.operation.state);
