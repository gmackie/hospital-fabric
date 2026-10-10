import assert from 'node:assert/strict';
const base=process.env.HOSPITAL_URL??'https://med.gmac.io';
const visitor=()=>({cookie:''});
const a=visitor(),b=visitor();
async function call(v,path,method='GET',origin=base){
  const response=await fetch(base+path,{method,headers:{cookie:v.cookie,origin}});
  if(response.headers.has('set-cookie'))v.cookie=response.headers.get('set-cookie').split(';')[0];
  const body=await response.json();return {status:response.status,body};
}
assert.equal((await fetch(base)).status,200);
assert.equal((await call(a,'/healthz')).body.ok,true);
assert.equal((await call(a,'/v1/admin/bootstrap','POST')).status,503);
assert.equal((await call(a,'/demo/api/start','POST','https://example.org')).status,403);
assert.equal((await call(a,'/demo/api/start','POST')).status,200);
assert.equal((await call(b,'/demo/api/start','POST')).status,200);
const first=(await call(a,'/demo/api/state')).body;
assert.equal(first.operation.state,'queued');
assert.notEqual(first.operation.id,(await call(b,'/demo/api/state')).body.operation.id);
assert.equal((await call(a,'/demo/api/deliver','POST')).body.operation.state,'outcome_unknown');
assert.equal((await call(b,'/demo/api/state')).body.operation.state,'queued');
assert.equal((await call(a,'/demo/api/reconcile','POST')).body.operation.state,'accepted');
await call(a,'/demo/api/result','POST');
const done=(await call(a,'/demo/api/result','POST')).body;
assert.equal(done.operation.state,'completed');assert.equal(done.results.length,1);
assert.equal(done.remoteOrder,true);assert.equal(done.operation.attempts,2);
console.log(JSON.stringify({base,verified:true,operation:done.operation,results:done.results,checks:['HTTPS page','health','disabled cloud bootstrap','cross-origin rejection','visitor isolation','lost ACK','reconciliation','result deduplication']},null,2));
