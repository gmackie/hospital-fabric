import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
const {outputFiles}=await build({entryPoints:['apps/worker/src/hospital/model.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {seedHospital,applyCommand,validateHospital}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
let serial=0;
const act=(s,action='advance',patientId='SIM-001')=>applyCommand(s,{requestId:`command-${++serial}`,version:0,action,...(action==='advance'?{patientId}:{})});
const to=(s,id,stage)=>{for(let n=0;n<20&&s.patients.find(p=>p.id===id).stage!==stage;n++)s=act(s,'advance',id);assert.equal(s.patients.find(p=>p.id===id).stage,stage);return s;};
test('connected medical, surgical and outpatient encounters conserve beds, lab orders and stock through outage',()=>{
 let s=seedHospital();s=act(s,'wan');
 for(const id of ['SIM-001','SIM-002','SIM-003'])s=to(s,id,'discharged');
 assert.equal(s.labOrders.length,3);assert.equal(s.patients.filter(p=>p.bed).length,0);assert.equal(s.stock,1);assert.equal(s.referrals,3);
 assert.ok(s.patients.find(p=>p.id==='SIM-002').image);assert.ok(s.events.some(e=>e.department==='Theatre'));
 s=act(s,'wan');assert.equal(s.referrals,0);validateHospital(s);
});
test('shared ward/theatre capacity rejects overbooking atomically',()=>{
 let s=seedHospital();for(const id of ['SIM-001','SIM-002','SIM-004'])s=to(s,id,'ward');
 s=to(s,'SIM-005','review');assert.throws(()=>act(s,'advance','SIM-005'),e=>e.code==='ward_full');
 s=to(s,'SIM-002','theatre');s=to(s,'SIM-001','discharged');s=to(s,'SIM-005','ward');
 assert.throws(()=>act(s,'advance','SIM-005'),e=>e.code==='theatre_busy');
 s=to(s,'SIM-002','recovery');s=to(s,'SIM-005','theatre');validateHospital(s);
});
test('stable lab correlation, idempotent dispensing and warehouse resupply',()=>{
 let s=to(seedHospital(),'SIM-001','lab_unknown');assert.equal(s.labOrders.length,1);assert.equal(s.patients[0].result,null);
 const c={version:0,requestId:'same-command-123',action:'advance',patientId:'SIM-001'};s=applyCommand(s,c);assert.deepEqual(applyCommand(s,c),s);
 assert.throws(()=>applyCommand(s,{...c,patientId:'SIM-002'}),e=>e.code==='idempotency_conflict');
 s=to(s,'SIM-001','discharged');const stock=s.stock;assert.throws(()=>act(s),e=>e.code==='journey_complete');assert.equal(s.stock,stock);
 s=act(s,'resupply');assert.equal(s.stock,stock+4);assert.equal(s.warehouse,8);validateHospital(s);
});
test('exhausted stock cannot discharge, replenishment retains patient correlation',()=>{
 let s=seedHospital();for(const id of ['SIM-001','SIM-002','SIM-003','SIM-004'])s=to(s,id,'discharged');
 s=to(s,'SIM-006','pharmacy');assert.throws(()=>act(s,'advance','SIM-006'),e=>e.code==='stock_empty');assert.equal(s.patients[5].stage,'pharmacy');
 s=act(s,'resupply');s=to(s,'SIM-006','discharged');assert.equal(s.patients[5].dispensed,true);
});
class DB{
 constructor(){this.db=new DatabaseSync(':memory:');}
 prepare(sql){const db=this.db;const statement=(values=[])=>({bind:(...v)=>statement(v),first:async()=>db.prepare(sql).get(...values)??null,all:async()=>({results:db.prepare(sql).all(...values),success:true,meta:{changes:0}}),run:async()=>{const m=db.prepare(sql).run(...values);return {results:[],success:true,meta:{changes:Number(m.changes)}}},perform:()=>{const p=db.prepare(sql);if(/^\s*SELECT/i.test(sql))return {results:p.all(...values),success:true,meta:{changes:0}};const m=p.run(...values);return {results:[],success:true,meta:{changes:Number(m.changes)}}}});return statement();}
 async exec(sql){this.db.exec(sql);}
 async batch(statements){this.db.exec('BEGIN');try{const r=statements.map(s=>s.perform());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 close(){this.db.close();}
}
async function setup(){const worker=(await import('../apps/worker/dist/index.mjs')).default;const env={DB:new DB(),LIS_DB:new DB(),DEMO_API_KEY:'synthetic-hospital-test-secret-only',ALLOW_DEV_BOOTSTRAP:'1'};await worker.fetch(new Request('https://demo.test/v1/admin/bootstrap',{method:'POST',headers:{'x-demo-token':env.DEMO_API_KEY}}),env);return {env,worker};}
async function call(h,path,body,cookie,origin='https://demo.test'){const r=await h.worker.fetch(new Request('https://demo.test/hospital/api/'+path,{method:body===undefined?'GET':'POST',headers:{origin,...(cookie?{cookie}:{}),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),h.env);return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
test('public session isolation, command replay, concurrent CAS, expired cookies and origin rejection',async()=>{
 const h=await setup();try{
 const a=await call(h,'session',{}),b=await call(h,'session',{});assert.equal(a.status,200);assert.notEqual(a.cookie,b.cookie);
 const c={version:0,requestId:'api-command-001',action:'advance',patientId:'SIM-001'};
 const result=await call(h,'commands',c,a.cookie);assert.equal(result.status,200);assert.equal(result.body.version,1);
 const replay=await call(h,'commands',c,a.cookie);assert.equal(replay.status,200);assert.equal(replay.body.version,1);
 assert.equal((await call(h,'state',undefined,b.cookie)).body.version,0);
 assert.equal((await call(h,'commands',{...c,requestId:'stale-command-2'},a.cookie)).status,409);
 const concurrent=await Promise.all([call(h,'commands',{...c,requestId:'concurrent-001',version:1},a.cookie),call(h,'commands',{...c,requestId:'concurrent-002',version:1},a.cookie)]);
 assert.deepEqual(concurrent.map(x=>x.status).sort(),[200,409]);
 assert.equal((await call(h,'commands',{...c,version:2},a.cookie,'https://evil.test')).status,403);
 assert.equal((await call(h,'commands',{...c,action:'erase'},a.cookie)).status,400);
 assert.equal((await call(h,'state')).status,401);
 h.env.DB.db.exec('UPDATE hospital_simulations SET expires_at=0');assert.equal((await call(h,'state',undefined,a.cookie)).status,401);
 }finally{h.env.DB.close();h.env.LIS_DB.close();}
});
test('shift limits bound arrivals and durable receipts while preserving safe replay',()=>{
 let s=seedHospital();for(let i=0;i<6;i++)s=act(s,'arrival');assert.equal(s.patients.length,12);
 assert.throws(()=>act(s,'arrival'),e=>e.code==='arrival_limit');
 const original={version:0,requestId:'first-clock-command',action:'clock'};s=applyCommand(s,original);
 while(s.receipts.length<240)s=act(s,'clock');
 assert.throws(()=>act(s,'clock'),e=>e.code==='shift_complete');assert.deepEqual(applyCommand(s,original),s);assert.equal(s.events.length,120);
});
