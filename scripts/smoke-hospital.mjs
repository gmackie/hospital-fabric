import assert from 'node:assert/strict';
const base=process.env.HOSPITAL_URL??'https://med.gmac.io';
async function call(visitor,path,body){const r=await fetch(base+'/hospital/api/'+path,{method:body===undefined?'GET':'POST',headers:{origin:base,cookie:visitor.cookie??'','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.has('set-cookie'))visitor.cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;}
const a={},b={};let state=await call(a,'session',{});await call(b,'session',{});
assert.equal((await fetch(base+'/hospital')).status,200);assert.equal((await fetch(base+'/delivery-lab')).status,200);
async function command(action,patientId){const c={requestId:crypto.randomUUID(),version:state.version,action,...(patientId?{patientId}:{})};state=await call(a,'commands',c);if(action==='wan'){const replay=await call(a,'commands',c);assert.equal(replay.version,state.version);}return state;}
await command('wan');
for(const id of ['SIM-001','SIM-002','SIM-003']){
 for(let n=0;n<15&&state.patients.find(p=>p.id===id).stage!=='discharged';n++)await command('advance',id);
 assert.equal(state.patients.find(p=>p.id===id).stage,'discharged');
}
assert.equal(state.stock,1);assert.equal(state.labOrders.length,3);assert.equal(state.referrals,3);assert.equal(state.patients.filter(p=>p.bed).length,0);
assert.ok(state.patients.find(p=>p.id==='SIM-002').image);
assert.equal((await call(b,'state')).version,0);assert.equal((await call(a,'state')).version,state.version);
await command('wan');assert.equal(state.referrals,0);
console.log(JSON.stringify({base,verified:true,version:state.version,discharged:3,labOrders:3,stock:state.stock,checks:['visitor isolation','medical/surgical/outpatient journeys','imaging','lab reconciliation','no duplicate replay','stock conservation','beds freed','WAN summary queue/recovery','durable reload']},null,2));
