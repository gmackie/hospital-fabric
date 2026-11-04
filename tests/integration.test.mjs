/** Real compiled Worker handlers, two SQLite databases, synthetic fixtures only. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createHmac } from 'node:crypto';

class D1SqliteMock {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON;');
  }
  prepare(sql) { return new D1Stmt(this, sql, []); }
  async exec(sql) {
    // Match workerd's D1 exec contract: each line is a separate statement.
    for (const statement of sql.trim().split('\n')) this.sqlite.prepare(statement).run();
    return {success:true};
  }
  async batch(statements) {
    this.sqlite.exec('BEGIN IMMEDIATE;');
    try {
      const result = statements.map(s => s.perform());
      this.sqlite.exec('COMMIT;');
      return result;
    } catch(error) {
      this.sqlite.exec('ROLLBACK;');
      throw error;
    }
  }
  close() { this.sqlite.close(); }
}
class D1Stmt {
  constructor(db,sql,values) { this.db=db;this.sql=sql;this.values=values; }
  bind(...values) { return new D1Stmt(this.db,this.sql,values); }
  async first() { return this.db.sqlite.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return this.perform(true); }
  async run() { return this.perform(); }
  perform(returnRows=false) {
    const prepared=this.db.sqlite.prepare(this.sql);
    const rows=returnRows || /^\s*SELECT\b/i.test(this.sql) ? prepared.all(...this.values) : null;
    if (rows) return {success:true,results:rows,meta:{changes:0}};
    const meta=prepared.run(...this.values);
    return {success:true,results:[],meta:{changes:Number(meta.changes)}};
  }
}

async function initialize() {
  const module=await import('../apps/worker/dist/index.mjs');
  const env={
    DB:new D1SqliteMock(),LIS_DB:new D1SqliteMock(),
    DEMO_API_KEY:'this-is-a-test-only-token-that-is-long',
    ALLOW_DEV_BOOTSTRAP:'1',
  };
  async function call(method,path,body,token=true,worker=module.default) {
    const headers=token?{'x-demo-token':env.DEMO_API_KEY}:{};
    if (body!==undefined) headers['content-type']='application/json';
    const response=await worker.fetch(new Request('http://127.0.0.1:9876'+path,{
      method,headers,body:body===undefined?undefined:JSON.stringify(body),
    }),env);
    return {status:response.status, body:await response.json()};
  }
  const boot=await call('POST','/v1/admin/bootstrap');
  assert.equal(boot.status,200,JSON.stringify(boot.body));
  return {env,call};
}

test('auth + input validation + clinical idempotency',async()=>{
  const {env,call}=await initialize();
  try {
    assert.equal((await call('GET','/healthz',undefined,false)).status,200);
    assert.equal((await call('GET','/v1/status',undefined,false)).status,401);
    const invalid=await call('POST','/v1/demo/lab-orders',{foo:'bar'});
    assert.equal(invalid.status,400,JSON.stringify(invalid));
    const p=await call('POST','/v1/demo/patients',{label:'SYNTHETIC-001'});
    assert.equal(p.status,201,JSON.stringify(p));
    const input={patientId:p.body.id,testCode:'CBC',requestId:'synthetic-req-001'};
    const order=await call('POST','/v1/demo/lab-orders',input);
    assert.equal(order.status,201,JSON.stringify(order));
    const retry=await call('POST','/v1/demo/lab-orders',input);
    assert.equal(retry.status,200,JSON.stringify(retry));
    assert.equal(retry.body.operationId,order.body.operationId);
    const collision=await call('POST','/v1/demo/lab-orders',{...input,testCode:'BMP'});
    assert.equal(collision.status,409,JSON.stringify(collision));
    const n=await env.DB.prepare('SELECT count(*) AS n FROM integration_operations').first();
    assert.equal(n.n,1);
  } finally {env.DB.close();env.LIS_DB.close();}
});

test('Effect 4 schema accepts every supported test code and rejects unknown codes',async()=>{
  const {env,call}=await initialize();
  try {
    const p=await call('POST','/v1/demo/patients',{label:'SYNTHETIC-SCHEMA'});
    for (const testCode of ['CBC','BMP','GLUCOSE']) {
      const response=await call('POST','/v1/demo/lab-orders',{
        patientId:p.body.id,testCode,requestId:`schema-${testCode}-001`,
      });
      assert.equal(response.status,201,JSON.stringify(response));
    }
    for (const testCode of ['UNKNOWN','cbc',null,42]) {
      const response=await call('POST','/v1/demo/lab-orders',{
        patientId:p.body.id,testCode,requestId:'schema-invalid-001',
      });
      assert.equal(response.status,400,JSON.stringify(response));
    }
    const missing=await call('POST','/v1/demo/lab-orders',{
      patientId:'missing-synthetic-patient',testCode:'CBC',requestId:'schema-missing-001',
    });
    assert.equal(missing.status,404,JSON.stringify(missing));
  } finally {env.DB.close();env.LIS_DB.close();}
});

test('Effect 4 failure results preserve concurrent duplicate recovery and database errors',async()=>{
  const {env,call}=await initialize();
  try {
    const p=await call('POST','/v1/demo/patients',{label:'SYNTHETIC-CONCURRENT'});
    const input={patientId:p.body.id,testCode:'CBC',requestId:'concurrent-request-001'};
    // Hold both inserts until both requests have read that no prior operation exists.
    const batch=env.DB.batch.bind(env.DB);
    let arrived=0;
    let release;
    const gate=new Promise(resolve=>{release=resolve;});
    env.DB.batch=async statements=>{
      if (++arrived===2) release();
      await gate;
      return batch(statements);
    };
    const responses=await Promise.all([
      call('POST','/v1/demo/lab-orders',input),
      call('POST','/v1/demo/lab-orders',input),
    ]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
    assert.equal(responses[0].body.operationId,responses[1].body.operationId);
    assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM outbox').first()).n,1);
    env.DB.batch=async()=>{throw new Error('Injected database failure');};
    const failed=await call('POST','/v1/demo/lab-orders',{...input,requestId:'database-failure-001'});
    assert.equal(failed.status,500,JSON.stringify(failed));
    assert.equal(failed.body.code,'db_error');
    assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM integration_operations').first()).n,1);
  } finally {env.DB.close();env.LIS_DB.close();}
});

test('Effect 4 dispatch failure routes conflicting destination state to manual review',async()=>{
  const {env,call}=await initialize();
  try {
    const p=await call('POST','/v1/demo/patients',{label:'SYNTHETIC-CONFLICT'});
    const order=await call('POST','/v1/demo/lab-orders',{
      patientId:p.body.id,testCode:'CBC',requestId:'destination-conflict-001',
    });
    await call('POST','/v1/demo/faults/drop-next-ack');
    await call('POST','/v1/admin/tick');
    await env.LIS_DB.prepare('UPDATE lis_orders SET payload_hash=?').bind('injected-conflict').run();
    const reconciled=await call('POST',`/v1/operations/${order.body.operationId}/reconcile`);
    assert.equal(reconciled.body.attempts[0].state,'needs_review',JSON.stringify(reconciled));
    assert.equal((await env.DB.prepare('SELECT state FROM outbox').first()).state,'blocked');
    assert.equal((await env.LIS_DB.prepare('SELECT count(*) AS n FROM lis_orders').first()).n,1);
  } finally {env.DB.close();env.LIS_DB.close();}
});

test('lost ACK + simulated Worker restart -> remote lookup, no duplicate',async()=>{
  const {env,call}=await initialize();
  try {
    const p=await call('POST','/v1/demo/patients',{label:'SYNTHETIC-RESTART'});
    const order=await call('POST','/v1/demo/lab-orders',{
      patientId:p.body.id,testCode:'CBC',requestId:'synthetic-restart-001',
    });
    const id=order.body.operationId;
    assert.equal((await call('POST','/v1/demo/faults/drop-next-ack')).status,200);
    const tick1=await call('POST','/v1/admin/tick');
    assert.equal(tick1.body.dispatched[0].state,'outcome_unknown',JSON.stringify(tick1));
    const n1=await env.LIS_DB.prepare('SELECT count(*) AS n FROM lis_orders').first();
    assert.equal(n1.n,1,'LIS committed once before the acknowledgment disappeared');
    const op1=await call('GET',`/v1/operations/${id}`);
    assert.equal(op1.body.operation.state,'outcome_unknown');
    // Fresh module simulates an isolate restart; state lives entirely in SQLite.
    const reload=await import(`../apps/worker/dist/index.mjs?restart=${Date.now()}`);
    const tick2=await call('POST',`/v1/operations/${id}/reconcile`,undefined,true,reload.default);
    assert.equal(tick2.body.attempts[0].state,'accepted',JSON.stringify(tick2));
    const n2=await env.LIS_DB.prepare('SELECT count(*) AS n FROM lis_orders').first();
    assert.equal(n2.n,1,'reconciliation queries destination instead of resending');
    const op2=await call('GET',`/v1/operations/${id}`);
    assert.equal(op2.body.operation.state,'accepted');
    const released=await call('POST',`/v1/demo/lis/orders/${id}/release`,{
      resultText:'SYNTHETIC: 7.5',unitCode:'10^9/L',
    });
    assert.equal(released.status,200,JSON.stringify(released));
    const tick3=await call('POST','/v1/admin/tick');
    assert.equal(tick3.body.results.processed,1,JSON.stringify(tick3));
    const chart=await call('GET',`/v1/demo/patients/${p.body.id}/results`);
    assert.equal(chart.body.results.length,1);
    assert.equal(chart.body.results[0].simulated,1);
    const tick4=await call('POST','/v1/admin/tick');
    assert.equal(tick4.body.results.processed,0);
    const events=await call('GET',`/v1/operations/${id}/events`);
    assert.equal(events.body.events.filter(e=>e.event_type==='order.accepted').length,1);
    assert.equal(events.body.events.filter(e=>e.event_type==='result.imported').length,1);
    assert.equal((await call('GET',`/v1/operations/${id}`)).body.operation.state,'completed');
  } finally {env.DB.close();env.LIS_DB.close();}
});

test('an early imported result stays completed after lost-ACK recovery and restart',async()=>{
  const {env,call}=await initialize();
  try {
    const patient=await call('POST','/v1/demo/patients',{label:'SYNTHETIC-EARLY-RESULT'});
    const input={patientId:patient.body.id,testCode:'CBC',requestId:'early-result-recovery-001'};
    const order=await call('POST','/v1/demo/lab-orders',input);
    assert.equal(order.status,201,JSON.stringify(order));
    const id=order.body.operationId;
    await call('POST','/v1/demo/faults/drop-next-ack');
    const delivery=await call('POST','/v1/admin/tick');
    assert.equal(delivery.body.dispatched[0].state,'outcome_unknown');
    // Keep reconciliation out of the next tick, without relying on wall-clock timing.
    await env.DB.prepare('UPDATE outbox SET available_at=9007199254740991 WHERE operation_id=?').bind(id).run();
    const remote=await env.LIS_DB.prepare('SELECT id,idempotency_key FROM lis_orders').first();
    // The independent synthetic LIS can release a report while its ACK is missing.
    const reportId=`demo-report:${remote.id}`;
    await env.LIS_DB.prepare(`INSERT INTO lis_results
      (id,lis_order_id,report_id,result_text,unit_code,released_at) VALUES(?,?,?,?,?,0)`)
      .bind(`demo-result:${remote.id}`,remote.id,reportId,'SYNTHETIC: 7.5','10^9/L').run();
    const early=await call('POST','/v1/admin/tick');
    assert.equal(early.status,200,JSON.stringify(early));
    assert.deepEqual(early.body.dispatched,[]);
    assert.deepEqual(early.body.results,{processed:1,skipped:0,quarantined:0});
    assert.equal((await call('GET',`/v1/operations/${id}`)).body.operation.state,'outcome_unknown');
    assert.equal((await env.DB.prepare('SELECT state FROM demo_lab_orders WHERE operation_id=?').bind(id).first()).state,'completed');
    assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM inbox').first()).n,1);
    assert.equal((await call('GET',`/v1/demo/patients/${patient.body.id}/results`)).body.results.length,1);

    const restarted=(await import('../apps/worker/dist/index.mjs?early-result-recovery')).default;
    const recovered=await call('POST',`/v1/operations/${id}/reconcile`,undefined,true,restarted);
    assert.equal(recovered.status,200,JSON.stringify(recovered));
    assert.equal(recovered.body.attempts[0].state,'accepted');
    const recoveredOperation=(await call('GET',`/v1/operations/${id}`)).body.operation;
    assert.equal(recoveredOperation.target_resource,`LisOrder/${remote.id}`);
    assert.equal(recoveredOperation.idempotency_key,remote.idempotency_key);
    assert.equal(recoveredOperation.state,'completed','Delivery recovery must preserve the already imported result');
    const replay=await call('POST','/v1/demo/lab-orders',input,true,restarted);
    assert.equal(replay.status,200,JSON.stringify(replay));
    assert.equal(replay.body.operationId,id);
    const repeated=await call('POST','/v1/admin/tick',undefined,true,restarted);
    // The persistent intake cursor (HF-8) already passed this result, so the repeat poll does not re-read it.
    assert.deepEqual(repeated.body.results,{processed:0,skipped:0,quarantined:0});
    const chart=(await call('GET',`/v1/demo/patients/${patient.body.id}/results`)).body.results;
    assert.equal(chart.length,1);
    assert.equal(chart[0].source_report_id,reportId);
    assert.equal(chart[0].test_code,'CBC');
    assert.equal(chart[0].result_text,'SYNTHETIC: 7.5');
    assert.equal(chart[0].unit_code,'10^9/L');
    assert.equal(chart[0].simulated,1);
    assert.equal((await call('GET',`/v1/operations/${id}`)).body.operation.state,'completed');
    assert.equal((await env.DB.prepare('SELECT state FROM demo_lab_orders WHERE operation_id=?').bind(id).first()).state,'completed');
    assert.equal((await env.DB.prepare('SELECT state FROM outbox WHERE operation_id=?').bind(id).first()).state,'delivered');
    assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM inbox').first()).n,1);
    assert.equal((await env.LIS_DB.prepare('SELECT count(*) AS n FROM lis_orders').first()).n,1);
    assert.equal((await env.LIS_DB.prepare('SELECT count(*) AS n FROM lis_results').first()).n,1);
    const events=(await call('GET',`/v1/operations/${id}/events`)).body.events;
    assert.equal(events.filter(e=>e.event_type==='result.imported').length,1);
    assert.equal(events.filter(e=>e.event_type==='order.accepted').length,1);
  } finally {env.DB.close();env.LIS_DB.close();}
});

test('selected reconciliation never dispatches unrelated pending work and records recovery history',async()=>{
  const {env,call}=await initialize();
  try {
    const p=await call('POST','/v1/demo/patients',{label:'SYNTHETIC-TARGETED'});
    const order=await call('POST','/v1/demo/lab-orders',{
      patientId:p.body.id,testCode:'CBC',requestId:'targeted-request-001',
    });
    const id=order.body.operationId;
    await call('POST','/v1/demo/faults/drop-next-ack');
    await call('POST','/v1/admin/tick');
    const other=await call('POST','/v1/demo/lab-orders',{
      patientId:p.body.id,testCode:'BMP',requestId:'unrelated-request-001',
    });
    // Make the unrelated order older so a generic sweep would choose it first.
    await env.DB.prepare('UPDATE outbox SET created_at=0 WHERE operation_id=?').bind(other.body.operationId).run();
    const response=await call('POST',`/v1/operations/${id}/reconcile`);
    assert.equal(response.status,200);
    assert.equal(response.body.attempts.length,1);
    assert.equal(response.body.attempts[0].operationId,id);
    assert.equal((await call('GET',`/v1/operations/${other.body.operationId}`)).body.operation.state,'queued');
    assert.equal((await env.LIS_DB.prepare('SELECT count(*) AS n FROM lis_orders').first()).n,1);
    const timeline=(await call('GET',`/v1/operations/${id}/events`)).body.events;
    assert.deepEqual(timeline.map(e=>e.event_type),[
      'order.queued','delivery.attempt_started','delivery.lookup_started','delivery.lookup_completed',
      'delivery.submit_started','order.outcome_unknown','delivery.attempt_started','delivery.lookup_started',
      'delivery.lookup_completed','delivery.reconciled','order.accepted',
    ]);
    assert.deepEqual(timeline.filter(e=>e.event_type==='delivery.lookup_completed').map(e=>JSON.parse(e.details_json).found),[false,true]);
    assert.equal((await call('POST',`/v1/operations/${id}/reconcile`)).status,409);
    assert.equal((await call('POST','/v1/operations/missing/reconcile')).status,404);
  } finally {env.DB.close();env.LIS_DB.close();}
});

test('static console has no secrets, stays local and does not bypass API authentication',async()=>{
  const {env,call}=await initialize();
  const worker=(await import('../apps/worker/dist/index.mjs')).default;
  try {
    for (const path of ['/','/console.js','/console.css']) {
      const response=await worker.fetch(new Request('http://127.0.0.1:9876'+path),env);
      assert.equal(response.status,200);
      assert.equal(response.headers.get('cache-control'),'no-store');
      assert.equal(response.headers.get('x-content-type-options'),'nosniff');
      assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);
      const text=await response.text();
      assert.ok(text.length>0);
      assert.ok(!text.includes(env.DEMO_API_KEY));
      if(path==='/') {
        assert.match(text,/\/console.js/);
        assert.doesNotMatch(text,/<script[^>]+src=["']https?:/);
      }
    }
    assert.equal((await call('GET','/v1/operations',undefined,false)).status,401);
    env.ALLOW_DEV_BOOTSTRAP='0';
    assert.equal((await call('POST','/v1/admin/tick')).status,403);
    assert.equal((await call('POST','/v1/demo/patients',{label:'SYNTHETIC-DISABLED'})).status,403);
  } finally {env.DB.close();env.LIS_DB.close();}
});

test('public walkthrough isolates visitors, rejects cross-origin writes and delivers exactly once',async()=>{
  const {env}=await initialize();
  env.PUBLIC_DEMO='1';env.ALLOW_DEV_BOOTSTRAP='0';
  const worker=(await import('../apps/worker/dist/index.mjs')).default;
  const browser=()=>({cookie:''});
  const a=browser(),b=browser();
  const call=async(visitor,path,method='GET',origin='https://med.gmac.io')=>{
    const response=await worker.fetch(new Request('https://med.gmac.io'+path,{method,headers:{cookie:visitor.cookie,origin}}),env);
    if(response.headers.has('set-cookie'))visitor.cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,body:await response.json()};
  };
  try {
    assert.equal((await call(a,'/demo/api/start','POST','https://evil.example')).status,403);
    assert.equal((await call(a,'/v1/operations')).status,401);
    await call(a,'/demo/api/start','POST');await call(b,'/demo/api/start','POST');
    const aId=(await call(a,'/demo/api/state')).body.operation.id;
    const bId=(await call(b,'/demo/api/state')).body.operation.id;
    assert.notEqual(aId,bId);
    await call(a,'/demo/api/start','POST');
    assert.equal((await call(a,'/demo/api/state')).body.operation.id,aId);
    const delivered=await call(a,'/demo/api/deliver','POST');
    assert.equal(delivered.body.operation.state,'outcome_unknown');
    assert.equal(delivered.body.remoteOrder,true);
    assert.equal((await call(b,'/demo/api/state')).body.operation.state,'queued');
    await call(a,'/demo/api/reconcile','POST');
    assert.equal((await call(a,'/demo/api/state')).body.operation.state,'accepted');
    // Older reports must not starve this visitor after the general 25-report batch fills.
    for(let i=0;i<26;i++) {
      env.LIS_DB.sqlite.prepare('INSERT INTO lis_orders(id,idempotency_key,patient_id,test_code,payload_hash,created_at) VALUES(?,?,?,?,?,0)').run('old-'+i,'old-key-'+i,'old-patient','CBC','old-hash');
      env.LIS_DB.sqlite.prepare('INSERT INTO lis_results(id,lis_order_id,report_id,result_text,unit_code,released_at) VALUES(?,?,?,?,?,0)').run('old-result-'+i,'old-'+i,'old-report-'+i,'SYNTHETIC','unit');
    }
    await call(a,'/demo/api/result','POST');await call(a,'/demo/api/result','POST');
    const done=(await call(a,'/demo/api/state')).body;
    assert.equal(done.operation.state,'completed');assert.equal(done.results.length,1);
    assert.equal((await env.LIS_DB.prepare("SELECT count(*) n FROM lis_orders WHERE id NOT LIKE 'old-%'").first()).n,1);
    env.DEMO_RATE_LIMITER={limit:async()=>({success:false})};
    assert.equal((await call(a,'/demo/api/state')).status,429);
  } finally {env.DB.close();env.LIS_DB.close();}
});

test('public hospital landing preserves delivery walkthrough and denies local-console assets',async()=>{
  const {env,call}=await initialize();
  const worker=(await import('../apps/worker/dist/index.mjs')).default;
  try {
    env.PUBLIC_DEMO='1';
    env.ALLOW_DEV_BOOTSTRAP='0';
    const root=await worker.fetch(new Request('https://med.gmac.io/'),env);
    assert.equal(root.status,200);
    const html=await root.text();
    assert.match(html,/\/hospital.js/);
    const lab=await worker.fetch(new Request('https://med.gmac.io/delivery-lab'),env);
    assert.equal(lab.status,200);
    assert.match(await lab.text(),/Your integration walkthrough/);
    assert.doesNotMatch(html,/\/console\.js|Local demo token/);
    for (const path of ['/console.js','/console.css']) {
      for (const headers of [{},{'x-demo-token':env.DEMO_API_KEY}]) {
        const response=await worker.fetch(new Request('https://med.gmac.io'+path,{headers}),env);
        assert.equal(response.status,404);
        assert.doesNotMatch(await response.text(),/Local demo token|Register synthetic patient/);
      }
    }
    assert.equal((await call('GET','/v1/operations',undefined,false)).status,401);
    assert.equal((await call('POST','/v1/admin/bootstrap')).status,403);
  } finally {env.DB.close();env.LIS_DB.close();}
});

test('public walkthrough recovers crashed dispatching leases without stealing active claims',async()=>{
  const {env}=await initialize();
  const worker=(await import('../apps/worker/dist/index.mjs')).default;
  env.PUBLIC_DEMO='1';env.ALLOW_DEV_BOOTSTRAP='0';
  let cookie='';
  const call=async(path,method='POST')=>{
    const response=await worker.fetch(new Request('https://med.gmac.io/demo/api/'+path,{
      method,headers:{cookie,origin:'https://med.gmac.io'},
    }),env);
    if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    assert.equal(response.status,200);
    return response.json();
  };
  try {
    await call('start');
    const lost=await call('deliver');
    const id=lost.operation.id;
    assert.equal(lost.operation.state,'outcome_unknown');
    // Model a crash during a later reconciliation claim, preserving the committed LIS order.
    await env.DB.prepare("UPDATE integration_operations SET state='dispatching' WHERE id=?").bind(id).run();
    await env.DB.prepare("UPDATE outbox SET state='processing',lease_token='crashed-claim',lease_until=? WHERE operation_id=?")
      .bind(Date.now()+60000,id).run();
    const active=await call('reconcile');
    assert.equal(active.operation.state,'dispatching','An active lease must not be stolen');
    assert.equal(active.operation.attempts,lost.operation.attempts);
    await env.DB.prepare('UPDATE outbox SET lease_until=0 WHERE operation_id=?').bind(id).run();
    const recovered=await call('reconcile');
    assert.equal(recovered.operation.state,'accepted');
    assert.equal(recovered.operation.attempts,lost.operation.attempts+1);
    assert.equal((await env.LIS_DB.prepare('SELECT count(*) n FROM lis_orders').first()).n,1);
    assert.equal(recovered.events.filter(e=>e.event_type==='delivery.reconciled').length,1);
    const page=await worker.fetch(new Request('https://med.gmac.io/delivery-lab'),env);
    assert.match(await page.text(),/Check delivery recovery/);
  } finally {env.DB.close();env.LIS_DB.close();}
});

test('real demo bridge accepts only authenticated fixed synthetic projections',async()=>{
 const {env}=await initialize();env.PUBLIC_DEMO='1';env.REAL_DEMO_BRIDGE_TOKEN='test-bridge-token-with-at-least-32-characters';
 const worker=(await import('../apps/worker/dist/index.mjs')).default;
 const publish=body=>worker.fetch(new Request('https://med.gmac.io/internal/demo/real-evidence',{method:'POST',headers:{authorization:'Bearer '+env.REAL_DEMO_BRIDGE_TOKEN},body:JSON.stringify(body)}),env);
 const proof={verifiedAt:new Date().toISOString(),value:13.2};
 assert.equal((await worker.fetch(new Request('https://med.gmac.io/internal/demo/real-evidence',{method:'POST',body:JSON.stringify(proof)}),env)).status,401);
 for(const body of [{...proof,patientId:'private'},{...proof,value:14},{...proof,verifiedAt:'2000-01-01'},null])assert.equal((await publish(body)).status,400);
 assert.equal((await publish(proof)).status,200);
 assert.equal((await publish(proof)).status,200);
 const response=await worker.fetch(new Request('https://med.gmac.io/demo/api/real'),env);const publicData=await response.json();
 assert.equal(publicData.fresh,true);assert.equal(publicData.result.value,13.2);assert.equal(publicData.syntheticOnly,true);
 assert.equal(JSON.stringify(publicData).includes(env.REAL_DEMO_BRIDGE_TOKEN),false);
 assert.equal(await env.DB.prepare('SELECT count(*) AS n FROM real_demo_evidence').first().then(x=>x.n),1);
 env.DB.close();env.LIS_DB.close();
});

test('unkeyed result intake advances past the first 25 released results (HF-8)',async()=>{
  const {env,call}=await initialize();
  try {
    const p=await call('POST','/v1/demo/patients',{label:'SYNTHETIC-INTAKE-CURSOR'});
    const ids=[];
    for (let n=0;n<30;n++) {
      const order=await call('POST','/v1/demo/lab-orders',{patientId:p.body.id,testCode:['CBC','BMP','GLUCOSE'][n%3],requestId:`intake-cursor-${String(n).padStart(3,'0')}`});
      ids.push(order.body.operationId);
    }
    for (let n=0;n<4&&(await env.DB.prepare("SELECT count(*) AS n FROM integration_operations WHERE state='accepted'").first()).n<30;n++) await call('POST','/v1/admin/tick');
    let imported=0;
    for (const [n,id] of ids.entries()) {
      const released=await call('POST',`/v1/demo/lis/orders/${id}/release`,{resultText:`SYNTHETIC: ${n}`,unitCode:'10^9/L'});
      assert.equal(released.status,200,JSON.stringify(released));
      // Interleave polls so earlier results are already imported when later ones arrive.
      if (n%7===6) imported+=(await call('POST','/v1/admin/tick')).body.results.processed;
    }
    for (let n=0;n<3;n++) imported+=(await call('POST','/v1/admin/tick')).body.results.processed;
    assert.equal(imported,30);
    assert.equal((await env.DB.prepare("SELECT count(*) AS n FROM integration_operations WHERE state='completed'").first()).n,30);
    assert.equal((await env.DB.prepare('SELECT count(*) AS n FROM demo_chart_results').first()).n,30);
    assert.equal((await call('POST','/v1/admin/tick')).body.results.processed,0);
  } finally {env.DB.close();env.LIS_DB.close();}
});

test('deployment profile comes from HF_PROFILE, not the request hostname (HF-13)',async()=>{
  const {env}=await initialize();
  const worker=(await import('../apps/worker/dist/index.mjs')).default;
  const get=async(path)=>{const r=await worker.fetch(new Request('https://hospital.example'+path),env);return {status:r.status,text:await r.text()};};
  try {
    env.HF_PROFILE='cloud';
    assert.equal(JSON.parse((await get('/healthz')).text).profile,'cloud');
    assert.match((await get('/')).text,/\/hospital\.js/);
    assert.equal((await get('/console.js')).status,404);
    assert.deepEqual(JSON.parse((await get('/demo/api/state')).text),{started:false});
    env.HF_PROFILE='site';
    assert.equal(JSON.parse((await get('/healthz')).text).profile,'site');
    assert.match((await get('/')).text,/\/console\.js/);
    assert.equal((await get('/console.js')).status,200);
    assert.equal(JSON.parse((await get('/demo/api/state')).text).code,'unauthorized');
    assert.equal(JSON.parse((await get('/hospital/api/protocol')).text).researchProfiles,false);
    for (const bad of [{HF_PROFILE:'production'},{HF_PROFILE:'site',PUBLIC_DEMO:'1'}]) {
      Object.assign(env,bad);
      const r=await get('/healthz');
      assert.equal(r.status,503);
      assert.equal(JSON.parse(r.text).code,'misconfigured');
      delete env.PUBLIC_DEMO;
    }
  } finally {env.DB.close();env.LIS_DB.close();}
});

test('dispatch resolves its adapter from the component registry and blocks before sending when unavailable (HF-13)',async()=>{
  for (const [sql,reason] of [
    ["UPDATE component_instances SET enabled=0 WHERE id='demo-openelis'",/disabled/],
    ["UPDATE component_instances SET product='OpenELIS' WHERE id='demo-openelis'",/No worker adapter for OpenELIS/],
  ]) {
    const {env,call}=await initialize();
    try {
      env.HF_PROFILE='site';
      const p=await call('POST','/v1/demo/patients',{label:'SYNTHETIC-REGISTRY'});
      const order=await call('POST','/v1/demo/lab-orders',{patientId:p.body.id,testCode:'CBC',requestId:'registry-001'});
      await env.DB.prepare(sql).run();
      const tick=await call('POST','/v1/admin/tick');
      assert.equal(tick.body.dispatched[0].state,'needs_review',JSON.stringify(tick.body));
      const op=await call('GET',`/v1/operations/${order.body.operationId}`);
      assert.match(op.body.operation.last_error,reason);
      assert.equal((await env.DB.prepare('SELECT state FROM outbox').first()).state,'blocked');
      assert.equal((await env.LIS_DB.prepare('SELECT count(*) AS n FROM lis_orders').first()).n,0);
      const events=(await call('GET',`/v1/operations/${order.body.operationId}/events`)).body.events.map(e=>e.event_type);
      assert.ok(!events.includes('delivery.submit_started'),events.join());
    } finally {env.DB.close();env.LIS_DB.close();}
  }
});

test('site and cloud profiles deploy the same bundle with the same bindings (HF-13)',async()=>{
  const {readFileSync}=await import('node:fs');
  const load=(name)=>JSON.parse(readFileSync(new URL(`../apps/worker/${name}`,import.meta.url),'utf8').replace(/^\s*\/\/.*$/gm,''));
  const site=load('wrangler.site.jsonc'), cloud=load('wrangler.cloud.jsonc');
  assert.equal(site.no_bundle,true,'both deployers must ship dist/index.mjs unchanged');
  assert.equal(site.vars.HF_PROFILE,'site');
  assert.equal(cloud.vars.HF_PROFILE,'cloud');
  for (const key of ['main','no_bundle','compatibility_date']) assert.equal(site[key],cloud[key],key);
  assert.deepEqual(site.triggers,cloud.triggers);
  const bindings=(c)=>c.d1_databases.map(d=>[d.binding,d.migrations_dir]);
  assert.deepEqual(bindings(site),bindings(cloud));
  assert.equal(site.routes,undefined,'celld does not support routes');
  assert.equal(site.vars.PUBLIC_DEMO,undefined);
  assert.deepEqual(cloud.routes,[{pattern:'hospital.gmac.io',custom_domain:true}]);
});

// HF-13 Phase R: two Workers from the same bundle, a site and a cloud, each with its own D1.
const LINK_SECRET='test-only-site-link-secret-0123456789abcdef';
function signedLink(path,body,{secret=LINK_SECRET,ts=Math.floor(Date.now()/1000),nonce=crypto.randomUUID(),text=JSON.stringify(body)}={}) {
  const signature=createHmac('sha256',secret).update(`${ts}.${nonce}.${text}`).digest('hex');
  return new Request('https://cloud.test'+path,{method:'POST',body:text,headers:{
    'content-type':'application/json','x-hf-link-timestamp':String(ts),'x-hf-link-nonce':nonce,'x-hf-link-signature':signature}});
}
async function linkPair() {
  const worker=(await import('../apps/worker/dist/index.mjs')).default;
  const site=await initialize(), cloud=await initialize();
  Object.assign(site.env,{HF_PROFILE:'site',SITE_ID:'test-site',SITE_LINK_URL:'https://cloud.test',SITE_LINK_SECRET:LINK_SECRET});
  Object.assign(cloud.env,{HF_PROFILE:'cloud',SITE_LINK_SECRET:LINK_SECRET});
  const link={mode:'up',requests:[]};
  const realFetch=globalThis.fetch;
  globalThis.fetch=async(input,init)=>{
    const request=new Request(input,init);
    link.requests.push(new URL(request.url).pathname);
    if (link.mode==='down') throw new TypeError('WAN unreachable');
    const response=await worker.fetch(request,cloud.env);
    // The cloud committed the request; the site never sees the acknowledgement.
    if (link.mode==='drop-ack') { link.mode='up'; throw new TypeError('connection reset'); }
    return response;
  };
  const cloudCall=async(method,path,request)=>{
    const response=await worker.fetch(request??new Request('https://cloud.test'+path,{method}),cloud.env);
    const type=response.headers.get('content-type')??'';
    return {status:response.status,body:type.includes('json')?await response.json():await response.text()};
  };
  const close=()=>{globalThis.fetch=realFetch;for (const env of [site.env,cloud.env]) {env.DB.close();env.LIS_DB.close();}};
  return {worker,site,cloud,link,cloudCall,close};
}
const heartbeat=(over={})=>({siteId:'test-site',sentAt:Date.now(),commit:null,unfinishedDeliveries:0,referralQueueDepth:0,...over});

test('site link rejects bad signatures, stale timestamps and replayed nonces (HF-13)',async()=>{
  const {cloud,cloudCall,close}=await linkPair();
  try {
    const ok=signedLink('/site-link/v1/heartbeat',heartbeat(),{nonce:'replay-nonce-0000000001'});
    assert.equal((await cloudCall('POST','',ok.clone())).status,200);
    const replay=await cloudCall('POST','',ok);
    assert.deepEqual([replay.status,replay.body.code],[401,'replayed_nonce']);
    const cases=[
      [{secret:'a-different-secret-that-is-long-enough-000'},'bad_signature'],
      [{ts:Math.floor(Date.now()/1000)-400},'stale_timestamp'],
      [{ts:Math.floor(Date.now()/1000)+400},'stale_timestamp'],
    ];
    for (const [options,code] of cases) {
      const r=await cloudCall('POST','',signedLink('/site-link/v1/heartbeat',heartbeat(),options));
      assert.deepEqual([r.status,r.body.code],[401,code],JSON.stringify(options));
    }
    const tampered=signedLink('/site-link/v1/heartbeat',heartbeat());
    const forged=new Request(tampered.url,{method:'POST',headers:tampered.headers,body:JSON.stringify(heartbeat({referralQueueDepth:999}))});
    assert.equal((await cloudCall('POST','',forged)).body.code,'bad_signature');
    const unsigned=await cloudCall('POST','',new Request('https://cloud.test/site-link/v1/heartbeat',{method:'POST',body:JSON.stringify(heartbeat())}));
    assert.equal(unsigned.status,401);
    // Only the one authentic heartbeat was stored; rejected requests never consumed a nonce.
    assert.equal((await cloud.env.DB.prepare('SELECT count(*) AS n FROM site_link_nonces').first()).n,1);
    assert.equal((await cloud.env.DB.prepare('SELECT referral_queue_depth AS d FROM site_link_heartbeats').first()).d,0);
  } finally {close();}
});

test('site referral outbox delivers exactly once across a WAN cut and a lost ACK (HF-13)',async()=>{
  const {site,cloud,link,cloudCall,close}=await linkPair();
  const sync=async()=>(await site.call('POST','/v1/site-link/sync')).body;
  const cloudCount=async()=>(await cloud.env.DB.prepare('SELECT count(*) AS n FROM site_link_inbound_referrals').first()).n;
  try {
    link.mode='down';
    const first=await site.call('POST','/v1/site-link/referrals',{requestId:'wan-001'});
    assert.equal(first.status,201,JSON.stringify(first));
    assert.equal((await site.call('POST','/v1/site-link/referrals',{requestId:'wan-001'})).status,200);
    for (const requestId of ['wan-002','wan-003']) await site.call('POST','/v1/site-link/referrals',{requestId});
    const offline=await sync();
    assert.equal(offline.heartbeat.ok,false);
    assert.equal(offline.referralQueueDepth,3);
    assert.equal(await cloudCount(),0);
    // Reconnect, but lose the acknowledgement of the first delivery after the cloud stored it.
    await site.env.DB.prepare('UPDATE site_link_referrals SET available_at=0').run();
    link.mode='drop-ack';
    const lost=await sync();
    assert.equal(lost.delivered[0].state,'retry',JSON.stringify(lost));
    assert.equal(await cloudCount(),1);
    await site.env.DB.prepare('UPDATE site_link_referrals SET available_at=0').run();
    const drained=await sync();
    assert.deepEqual(drained.delivered.map(d=>d.state),['delivered','delivered','delivered'],JSON.stringify(drained));
    assert.equal(drained.referralQueueDepth,0);
    assert.equal(drained.heartbeat.ok,true);
    assert.equal(await cloudCount(),3);
    const keys=(await cloud.env.DB.prepare('SELECT idempotency_key FROM site_link_inbound_referrals ORDER BY idempotency_key').all()).results.map(r=>r.idempotency_key);
    assert.deepEqual(keys,['test-site:referral:wan-001','test-site:referral:wan-002','test-site:referral:wan-003']);
    const attempts=(await site.env.DB.prepare("SELECT attempts FROM site_link_referrals WHERE idempotency_key='test-site:referral:wan-001'").first()).attempts;
    assert.equal(attempts,3);
    // A crashed delivery's expired lease is reclaimed; a key reused for a different payload is refused.
    await site.call('POST','/v1/site-link/referrals',{requestId:'crash-001'});
    await site.env.DB.prepare("UPDATE site_link_referrals SET state='processing',lease_token='stale',lease_until=0 WHERE idempotency_key='test-site:referral:crash-001'").run();
    assert.deepEqual((await sync()).delivered.map(d=>d.state),['delivered']);
    assert.equal(await cloudCount(),4);
    const conflict=await cloudCall('POST','',signedLink('/site-link/v1/referrals',{siteId:'test-site',idempotencyKey:'test-site:referral:wan-001',payload:{synthetic:true,reason:'other'}}));
    assert.deepEqual([conflict.status,conflict.body.code],[409,'referral_conflict']);
    assert.equal(await cloudCount(),4);
    const status=(await cloudCall('GET','/site-link/v1/status')).body;
    assert.equal(status.sites[0].referralsReceived,4);
    assert.equal(status.sites[0].reportedReferralQueueDepth,0);
  } finally {close();}
});

test('cloud link status goes online then offline and exposes no secrets (HF-13)',async()=>{
  const {worker,site,cloud,link,cloudCall,close}=await linkPair();
  try {
    assert.deepEqual((await cloudCall('GET','/site-link/v1/status')).body.sites,[]);
    await worker.scheduled(undefined,site.env);
    assert.ok(link.requests.includes('/site-link/v1/heartbeat'));
    let status=(await cloudCall('GET','/site-link/v1/status')).body;
    assert.equal(status.sites[0].siteId,'test-site');
    assert.equal(status.sites[0].online,true);
    assert.match((await cloudCall('GET','/site-link')).body,/>online</);
    await cloud.env.DB.prepare('UPDATE site_link_heartbeats SET received_at=?').bind(Date.now()-181_000).run();
    status=(await cloudCall('GET','/site-link/v1/status')).body;
    assert.equal(status.sites[0].online,false);
    const page=(await cloudCall('GET','/site-link')).body;
    assert.match(page,/>offline</);
    for (const text of [JSON.stringify(status),page]) {
      assert.ok(!text.includes(LINK_SECRET));
      assert.ok(!text.includes(site.env.DEMO_API_KEY));
    }
  } finally {close();}
});

test('only the site sends and only the cloud receives; no secret means disabled (HF-13)',async()=>{
  const {worker,site,cloud,link,cloudCall,close}=await linkPair();
  try {
    // The site does not receive.
    const siteReceive=await worker.fetch(signedLink('/site-link/v1/heartbeat',heartbeat()),site.env);
    assert.equal(siteReceive.status,404);
    assert.equal((await worker.fetch(new Request('https://site.test/site-link/v1/status'),site.env)).status,404);
    // The cloud does not send, even with an operator token and a URL configured.
    Object.assign(cloud.env,{SITE_LINK_URL:'https://cloud.test'});
    const cloudSend=await cloud.call('POST','/v1/site-link/referrals',{});
    assert.deepEqual([cloudSend.status,cloudSend.body.code],[404,'site_link_disabled']);
    link.requests.length=0;
    await worker.scheduled(undefined,cloud.env);
    assert.deepEqual(link.requests,[]);
    // Without the secret both ends are disabled.
    delete cloud.env.SITE_LINK_SECRET;
    assert.equal((await cloudCall('GET','/site-link/v1/status')).status,404);
    assert.equal((await cloudCall('POST','',signedLink('/site-link/v1/heartbeat',heartbeat()))).status,404);
    delete site.env.SITE_LINK_SECRET;
    assert.equal((await site.call('POST','/v1/site-link/referrals',{})).status,404);
    await worker.scheduled(undefined,site.env);
    assert.deepEqual(link.requests,[]);
    // A short secret counts as unset.
    site.env.SITE_LINK_SECRET='too-short';
    assert.equal((await site.call('POST','/v1/site-link/referrals',{})).status,404);
    // Local may do both, for tests.
    Object.assign(site.env,{HF_PROFILE:'local',SITE_LINK_SECRET:LINK_SECRET});
    assert.equal((await site.call('POST','/v1/site-link/referrals',{})).status,201);
    assert.equal((await worker.fetch(new Request('https://local.test/site-link/v1/status'),site.env)).status,200);
  } finally {close();}
});
