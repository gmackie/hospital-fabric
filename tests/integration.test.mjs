/** Real compiled Worker handlers, two SQLite databases, synthetic fixtures only. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

class D1SqliteMock {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec('PRAGMA foreign_keys=ON;');
  }
  prepare(sql) { return new D1Stmt(this, sql, []); }
  async exec(sql) { this.sqlite.exec(sql); return {success:true}; }
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
