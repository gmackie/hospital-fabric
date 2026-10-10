import { Effect } from 'effect';
import type { Env } from '../db/types';
import { ApiError } from '../domain/errors';
import { createPatient, createLabOrder, getOperation, getOperationEvents } from '../db/operations';
import { runDispatchBatch } from '../jobs/dispatch';
import { pollResults } from '../jobs/results';
import { releaseSimulatedResult, findRemoteOrder } from '../adapters/lis-simulator';

type Session = { token: string; patient_id: string; operation_id: string | null };
const json = (value: unknown, status=200, headers={}) => Response.json(value, {status, headers:{'cache-control':'no-store', ...headers}});
export async function publicDemo(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'POST') throw new ApiError(405,'method_not_allowed','Use GET or POST');
  if (request.method === 'POST' && request.headers.get('origin') !== url.origin) throw new ApiError(403,'origin_required','Use the demo on this site');
  if (env.DEMO_RATE_LIMITER && !(await env.DEMO_RATE_LIMITER.limit({key:request.headers.get('cf-connecting-ip')??'local'})).success)
    throw new ApiError(429,'rate_limited','Please wait a minute before continuing');
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)hospital_demo=([a-f0-9]{64})(?:;|$)/)?.[1];
  let session = token ? await env.DB.prepare('SELECT token,patient_id,operation_id FROM public_demo_sessions WHERE token=? AND expires_at>?').bind(token,Date.now()).first<Session>() : null;
  if (url.pathname === '/demo/api/start' && request.method === 'POST') {
    if (!session) {
      const slot = await env.DB.prepare('UPDATE public_demo_budget SET used=used+1 WHERE id=1 AND used<5000 RETURNING used').first<{used:number}>();
      if (!slot) throw new ApiError(503,'demo_full','The demo is at capacity. Please try again later');
      const patient = await createPatient(env,'SYNTHETIC DEMO PATIENT');
      const newToken = crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
      await env.DB.prepare('INSERT INTO public_demo_sessions(token,patient_id,created_at,expires_at) VALUES(?,?,?,?)').bind(newToken,patient.id,Date.now(),Date.now()+86400000).run();
      session = {token:newToken,patient_id:patient.id,operation_id:null};
    }
    // A stable key makes concurrent start requests with the same cookie idempotent.
    const order = await Effect.runPromise(createLabOrder(env,{patientId:session.patient_id,testCode:'CBC',requestId:session.token}));
    await env.DB.prepare('UPDATE public_demo_sessions SET operation_id=? WHERE token=?').bind(order.operationId,session.token).run();
    return json({started:true},200,{'set-cookie':`hospital_demo=${session.token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`});
  }
  if (!session?.operation_id) return json({started:false});
  const op = await getOperation(env,session.operation_id);
  if (!op) throw new ApiError(404,'not_found','Start a new demo');
  if (request.method === 'POST') {
    if (url.pathname === '/demo/api/deliver') {
      if (op.state==='queued') {
        await env.DB.prepare('INSERT OR IGNORE INTO demo_faults(name,remaining) VALUES(?,1)').bind(`drop_ack:${op.idempotency_key}`).run();
        await runDispatchBatch(env,1,op.id);
      }
    } else if (url.pathname === '/demo/api/reconcile') {
      // A crashed claim can remain dispatching; the dispatcher only reclaims an expired lease.
      if (op.state==='outcome_unknown' || op.state==='retry' || op.state==='dispatching') {
        await env.DB.prepare("UPDATE outbox SET available_at=0 WHERE operation_id=? AND state='uncertain'").bind(op.id).run();
        await runDispatchBatch(env,1,op.id);
      }
    } else if (url.pathname === '/demo/api/result') {
      if (op.state==='accepted' || op.state==='completed') {
        await releaseSimulatedResult(env,op,'SYNTHETIC: 7.5','10^9/L');
        await pollResults(env,1,op.idempotency_key);
      }
    } else throw new ApiError(404,'not_found','Unknown demo action');
  } else if (url.pathname !== '/demo/api/state') throw new ApiError(404,'not_found','Unknown demo endpoint');
  const current = await getOperation(env,op.id);
  const remote = await findRemoteOrder(env,op.idempotency_key);
  const {results} = await env.DB.prepare('SELECT test_code,result_text,unit_code FROM demo_chart_results WHERE patient_id=?').bind(session.patient_id).all();
  return json({started:true,operation:{id:op.id,state:current?.state,attempts:current?.attempt_count},remoteOrder:!!remote,results,events:await getOperationEvents(env,op.id)});
}
