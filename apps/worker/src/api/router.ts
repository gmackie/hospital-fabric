import { publicDemo } from '../demo/api';
import { demoPage } from '../demo/page';
import { Effect } from 'effect';
import type { Env } from '../db/types';
import { ApiError } from '../domain/errors';
import { decodeOrder, decodePatient, decodeRelease } from '../domain/contracts';
import { createLabOrder,createPatient,getOperation,getOperationEvents,getOrders } from '../db/operations';
import { releaseSimulatedResult } from '../adapters/lis-simulator';
import { runDispatchBatch } from '../jobs/dispatch';
import { pollResults } from '../jobs/results';
import { CORE_MIGRATION, OPERATIONS_MIGRATION, PUBLIC_DEMO_MIGRATION, LIS_MIGRATION } from '../generated/migrations';

const json = (body: unknown,status=200) => Response.json(body,{status,headers:{'cache-control':'no-store'}});
const noStore = { 'cache-control':'no-store' };

async function bodyJson(request: Request) {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > 8_192) throw new ApiError(413,'payload_too_large','Body limit is 8 KiB');
  const text = await request.text();
  if (text.length > 8_192) throw new ApiError(413,'payload_too_large','Body limit is 8 KiB');
  try { return JSON.parse(text) as unknown; }
  catch { throw new ApiError(400,'invalid_json','Expected a JSON request body'); }
}
function requireAuth(request: Request, env: Env) {
  const token = env.DEMO_API_KEY;
  if (!token || token.length < 24) throw new ApiError(503,'unconfigured','Configure DEMO_API_KEY (>=24 chars)');
  if (request.headers.get('x-demo-token')!==token) throw new ApiError(401,'unauthorized','Valid x-demo-token required');
}
function requireDemoBootstrap(env: Env) {
  if (env.ALLOW_DEV_BOOTSTRAP!=='1') throw new ApiError(403,'disabled','This endpoint is disabled outside the local demo');
}
function routeId(path:string,prefix:string,suffix='') {
  if (!path.startsWith(prefix) || !path.endsWith(suffix)) return null;
  const between=path.slice(prefix.length,path.length-suffix.length);
  return /^[a-zA-Z0-9_.:-]{1,130}$/.test(between) ? between : null;
}

export async function serve(request:Request,env:Env):Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  if (method==='GET' && path==='/healthz') return json({ok:true,service:'hospital-fabric',mode:'synthetic-only'});
  if (method==='OPTIONS') return new Response(null,{status:204,headers:noStore});
  try {
    if (env.PUBLIC_DEMO==='1' && method==='GET' && path==='/') return demoPage();
    if (env.PUBLIC_DEMO==='1' && path.startsWith('/demo/api/')) return await publicDemo(request,env);
    requireAuth(request,env);
    if (method==='POST' && path==='/v1/admin/bootstrap') {
      requireDemoBootstrap(env);
      // For local prototype only; fleet migrations use 'celld d1 migrations apply'.
      await env.DB.exec(CORE_MIGRATION);
      await env.DB.exec(OPERATIONS_MIGRATION);
      await env.DB.exec(PUBLIC_DEMO_MIGRATION);
      await env.LIS_DB.exec(LIS_MIGRATION);
      return json({ready:true,syntheticOnly:true,warning:'Prototype bootstrapped. Not a clinical system.'});
    }
    if (method==='GET' && path==='/readyz') {
      const db=await env.DB.prepare('SELECT count(*) AS n FROM facilities').first<{n:number}>();
      const lis=await env.LIS_DB.prepare('SELECT count(*) AS n FROM lis_orders').first<{n:number}>();
      return json({ready:!!db&&!!lis,controlDb:true,lisDb:true});
    }
    if (method==='GET' && path==='/v1/facilities') {
      const {results}=await env.DB.prepare('SELECT id,name,profile,demo_only FROM facilities ORDER BY name LIMIT 100').all();
      return json({facilities:results});
    }
    if (method==='GET' && path==='/v1/components') {
      const {results}=await env.DB.prepare(`SELECT id,facility_id,kind,product,version,enabled,capabilities_json
        FROM component_instances ORDER BY kind LIMIT 100`).all();
      return json({components:results});
    }
    if (method==='GET' && path==='/v1/devices') {
      const {results}=await env.DB.prepare(`SELECT id,facility_id,manufacturer,model,interface_kind,clinical_status,updated_at
        FROM medical_devices ORDER BY updated_at DESC LIMIT 100`).all();
      return json({devices:results});
    }
    if (method==='GET' && path==='/v1/operations') return json({orders:await getOrders(env)});
    if (method==='POST' && path==='/v1/demo/patients') {
      requireDemoBootstrap(env);
      const input = await decodePatient(await bodyJson(request)).catch(() => {throw new ApiError(400,'invalid_input','Invalid synthetic patient payload')});
      return json(await createPatient(env,input.label),201);
    }
    if (method==='POST' && path==='/v1/demo/lab-orders') {
      requireDemoBootstrap(env);
      const input = await decodeOrder(await bodyJson(request)).catch(() => {throw new ApiError(400,'invalid_input','Invalid synthetic laboratory order')});
      const result = await Effect.runPromise(Effect.result(createLabOrder(env,input)));
      if (result._tag==='Failure') throw result.failure;
      return json(result.success,result.success.duplicated?200:201);
    }
    if (method==='POST' && path==='/v1/demo/faults/drop-next-ack') {
      requireDemoBootstrap(env);
      await env.DB.prepare(`INSERT INTO demo_faults(name,remaining) VALUES('drop_next_ack',1)
        ON CONFLICT(name) DO UPDATE SET remaining=1`).run();
      return json({armed:true,simulatedOnly:true});
    }
    if (method==='POST' && path==='/v1/admin/tick') {
      requireDemoBootstrap(env);
      const dispatched=await runDispatchBatch(env,10);
      const results=await pollResults(env);
      return json({dispatched,results});
    }
    if (method==='GET' && path==='/v1/status') {
      const {results}=await env.DB.prepare('SELECT state,count(*) AS n FROM integration_operations GROUP BY state').all();
      const pending=await env.DB.prepare("SELECT count(*) AS n FROM outbox WHERE state NOT IN ('delivered','blocked')").first<{n:number}>();
      return json({operations:results,unfinishedDeliveries:pending?.n??0,syntheticOnly:true});
    }
    const manualReconcileId=routeId(path,'/v1/operations/','/reconcile');
    if (method==='POST' && manualReconcileId) {
      requireDemoBootstrap(env);
      const op=await getOperation(env,manualReconcileId);
      if (!op) throw new ApiError(404,'not_found','Operation not found');
      if (op.state!=='outcome_unknown' && op.state!=='retry')
        throw new ApiError(409,'not_reconcilable','Operation does not require delivery reconciliation');
      await env.DB.prepare("UPDATE outbox SET available_at=0 WHERE operation_id=? AND state='uncertain'")
        .bind(manualReconcileId).run();
      // Always reads remote state BEFORE resending; cannot blindly duplicate clinical requests.
      return json({attempts:await runDispatchBatch(env,1), operationId:manualReconcileId});
    }
    const eventId=routeId(path,'/v1/operations/','/events');
    if (method==='GET' && eventId) {
      const op=await getOperation(env,eventId);
      if (!op) throw new ApiError(404,'not_found','Operation not found');
      return json({operationId:eventId,events:await getOperationEvents(env,eventId)});
    }
    const opId=routeId(path,'/v1/operations/');
    if (method==='GET' && opId) {
      const op=await getOperation(env,opId);
      if (!op) throw new ApiError(404,'not_found','Operation not found');
      return json({operation:op});
    }
    const releaseId=routeId(path,'/v1/demo/lis/orders/','/release');
    if (method==='POST' && releaseId) {
      requireDemoBootstrap(env);
      const data=await decodeRelease(await bodyJson(request)).catch(() => {throw new ApiError(400,'invalid_input','Invalid synthetic result')});
      const op=await getOperation(env,releaseId);
      if (!op) throw new ApiError(404,'not_found','Operation not found');
      if (op.state!=='accepted' && op.state!=='completed') {
        throw new ApiError(409,'not_accepted','Order is not confirmed accepted by the simulated LIS');
      }
      return json(await releaseSimulatedResult(env,op,data.resultText,data.unitCode));
    }
    const resultsPatientId=routeId(path,'/v1/demo/patients/','/results');
    if (method==='GET' && resultsPatientId) {
      const {results}=await env.DB.prepare(`SELECT source_report_id,test_code,result_text,unit_code,created_at,simulated
        FROM demo_chart_results WHERE patient_id=? ORDER BY created_at DESC`).bind(resultsPatientId).all();
      return json({patientId:resultsPatientId,synthetic:true,results});
    }
    return json({code:'not_found',message:`No ${method} handler for ${path}`},404);
  } catch(error) {
    if (error instanceof ApiError) return json({code:error.code,message:error.message},error.status);
    // Do not reflect internal SQL/protocol errors or potentially sensitive data to clients.
    if (error instanceof Error && error.name.includes('Schema')) {
      return json({code:'invalid_input',message:'Payload does not match the expected schema'},400);
    }
    console.error('Worker request failed',error instanceof Error?error.name:'Unknown');
    return json({code:'internal_error',message:'Operation failed; inspect local server logs'},500);
  }
}
