import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
const bundle=async entry=>{const {outputFiles}=await build({entryPoints:[entry],bundle:true,write:false,format:'esm',platform:'node'});return import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));};
const {seedHospital,applyCommand,validateHospital,resolveProfile,DEFAULT_PROFILE}=await bundle('apps/worker/src/hospital/model.ts');
const {canonicalJson,stateDigest}=await bundle('apps/worker/src/hospital/canonical.ts');
const vectors=JSON.parse(readFileSync('tests/fixtures/canonical-vectors.json','utf8'));
let serial=0;
const act=(s,action='advance',patientId='SIM-001')=>applyCommand(s,{requestId:`research-${++serial}`,version:0,action,...(action==='advance'?{patientId}:{})});
const to=(s,id,stage)=>{for(let n=0;n<20&&s.patients.find(p=>p.id===id).stage!==stage;n++)s=act(s,'advance',id);assert.equal(s.patients.find(p=>p.id===id).stage,stage);return s;};
const research={initialPatients:10,maxArrivals:40,beds:8,theatres:2,stock:6,warehouse:40,commandLimit:1200};

test('canonical JSON and digest match the shared kybernos vectors',async()=>{
 assert.equal(vectors.algorithm,'sha256-canonical-json/v1');
 for(const c of vectors.cases){assert.equal(canonicalJson(c.value),c.canonical,c.name);assert.equal(await stateDigest(c.value),c.sha256,c.name);}
 assert.throws(()=>canonicalJson({x:1.5}),/integer/);assert.throws(()=>canonicalJson({x:undefined}),/undefined/);
});

test('the default profile is byte-identical to the original public shift',()=>{
 const s=seedHospital();assert.equal('profile' in s,false);assert.deepEqual(seedHospital(DEFAULT_PROFILE),s);
 assert.deepEqual(DEFAULT_PROFILE,{initialPatients:6,maxArrivals:12,beds:3,theatres:1,stock:4,warehouse:12,commandLimit:240});
});

test('a research profile scales arrivals, beds, theatres, stock and command limits',()=>{
 let s=seedHospital(research);assert.deepEqual(s.profile,research);assert.equal(s.patients.length,10);assert.equal(s.beds.length,8);assert.equal(s.beds[7],'W-08');
 for(let i=0;i<30;i++)s=act(s,'arrival');assert.equal(s.patients.length,40);assert.equal(s.patients[39].id,'SIM-040');assert.match(s.patients[39].name,/Demo/);
 assert.throws(()=>act(s,'arrival'),e=>e.code==='arrival_limit');
 // Two theatres run concurrently; a third surgical patient waits.
 for(const id of ['SIM-002','SIM-005','SIM-008'])s=to(s,id,'ward');
 s=to(s,'SIM-002','theatre');s=to(s,'SIM-005','theatre');assert.throws(()=>act(s,'advance','SIM-008'),e=>e.code==='theatre_busy');
 validateHospital(s);
 for(const id of ['SIM-001','SIM-003','SIM-004','SIM-006','SIM-007','SIM-009'])s=to(s,id,'discharged');
 assert.throws(()=>to(s,'SIM-010','discharged'),e=>e.code==='stock_empty');s=act(s,'resupply');assert.equal(s.warehouse,36);validateHospital(s);
 while(s.receipts.length<1200)s=act(s,'clock');assert.throws(()=>act(s,'clock'),e=>e.code==='shift_complete');
});

test('profiles outside the bounded caps are rejected',()=>{
 for(const bad of [{...research,maxArrivals:61},{...research,initialPatients:41},{...research,beds:0},{...research,theatres:7},{...research,commandLimit:2001},{...research,stock:-1},{...research,beds:1.5},{...research,extra:1},{initialPatients:1}])
  assert.throws(()=>resolveProfile(bad),e=>e.code==='invalid_profile',JSON.stringify(bad));
 assert.deepEqual(resolveProfile(undefined),DEFAULT_PROFILE);
});

class DB{
 constructor(){this.db=new DatabaseSync(':memory:');}
 prepare(sql){const db=this.db;const statement=(values=[])=>({bind:(...v)=>statement(v),first:async()=>db.prepare(sql).get(...values)??null,all:async()=>({results:db.prepare(sql).all(...values),success:true,meta:{changes:0}}),run:async()=>{const m=db.prepare(sql).run(...values);return {results:[],success:true,meta:{changes:Number(m.changes)}}},perform:()=>{const p=db.prepare(sql);if(/^\s*SELECT/i.test(sql))return {results:p.all(...values),success:true,meta:{changes:0}};const m=p.run(...values);return {results:[],success:true,meta:{changes:Number(m.changes)}}}});return statement();}
 async exec(sql){this.db.exec(sql);}
 async batch(statements){this.db.exec('BEGIN');try{const r=statements.map(s=>s.perform());this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 close(){this.db.close();}
}
async function setup(extra={}){const worker=(await import('../apps/worker/dist/index.mjs')).default;const env={DB:new DB(),LIS_DB:new DB(),DEMO_API_KEY:'synthetic-hospital-test-secret-only',ALLOW_DEV_BOOTSTRAP:'1',...extra};await worker.fetch(new Request('https://demo.test/v1/admin/bootstrap',{method:'POST',headers:{'x-demo-token':env.DEMO_API_KEY}}),env);return {env,worker};}
async function call(h,path,body,cookie){const r=await h.worker.fetch(new Request('https://demo.test/hospital/api/'+path,{method:body===undefined?'GET':'POST',headers:{origin:'https://demo.test',...(cookie?{cookie}:{}),'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),h.env);return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}

test('local research sessions export canonical digests that track every command',async()=>{
 const h=await setup();try{
 const proto=await call(h,'protocol');assert.equal(proto.status,200);
 assert.equal(proto.body.model,'hospital-fabric-shift');assert.equal(proto.body.modelVersion,1);assert.equal(proto.body.actionSemantics,'hospital-fabric-commands/v1');
 assert.equal(proto.body.digest,'sha256-canonical-json/v1');assert.equal(proto.body.researchProfiles,true);assert.deepEqual(proto.body.defaultProfile,DEFAULT_PROFILE);
 const a=await call(h,'session',{profile:research});assert.equal(a.status,200);assert.equal(a.body.patients.length,10);
 const before=await call(h,'export',undefined,a.cookie);assert.equal(before.status,200);
 assert.equal(before.body.schema,'hospital-fabric-shift-export/v1');assert.equal(before.body.version,0);assert.deepEqual(before.body.profile,research);
 assert.equal(before.body.stateDigest,await stateDigest(seedHospital(research)));assert.equal(a.body.stateDigest,before.body.stateDigest);
 const c={version:0,requestId:'research-api-001',action:'advance',patientId:'SIM-001'};
 const moved=await call(h,'commands',c,a.cookie);assert.equal(moved.status,200);
 const after=await call(h,'export',undefined,a.cookie);assert.equal(after.body.version,1);assert.equal(after.body.state.receipts.length,1);
 assert.equal(after.body.stateDigest,await stateDigest(applyCommand(seedHospital(research),c)));assert.equal(moved.body.stateDigest,after.body.stateDigest);
 assert.equal((await call(h,'session',{profile:{...research,beds:99}})).status,400);
 const plain=await call(h,'session',{});assert.equal((await call(h,'export',undefined,plain.cookie)).body.stateDigest,await stateDigest(seedHospital()));
 }finally{h.env.DB.close();h.env.LIS_DB.close();}
});

test('the public demo rejects research profiles and keeps fixed limits',async()=>{
 const h=await setup({PUBLIC_DEMO:'1'});try{
 assert.equal((await call(h,'protocol')).body.researchProfiles,false);
 const r=await call(h,'session',{profile:research});assert.equal(r.status,403);assert.equal(r.body.code,'profile_not_allowed');
 const ok=await call(h,'session',{});assert.equal(ok.status,200);assert.equal(ok.body.patients.length,6);
 }finally{h.env.DB.close();h.env.LIS_DB.close();}
});
