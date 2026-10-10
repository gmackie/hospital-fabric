import type { Env } from '../db/types';
import { RemoteOutcomeUnknown, ReconciliationRequired, ApiError } from '../domain/errors';
import type { LaboratoryAdapter } from './contracts';

export type SimulatedOrder = {
  id: string;
  idempotency_key: string;
  patient_id: string;
  test_code: string;
  payload_hash: string;
  state: string;
};

/** Simulator only. Do not use to report clinical lab results or connect patient care. */
export async function findRemoteOrder(env: Env, key: string): Promise<SimulatedOrder | null> {
  return env.LIS_DB.prepare('SELECT * FROM lis_orders WHERE idempotency_key=?').bind(key).first<SimulatedOrder>();
}

export async function sendOrder(env: Env, data: {
  key: string; hash: string; patientId: string; testCode: string;
}): Promise<SimulatedOrder> {
  const preexisting = await findRemoteOrder(env, data.key);
  if (preexisting) {
    if (preexisting.payload_hash !== data.hash) throw new ReconciliationRequired('Remote idempotency key has different content');
    return preexisting;
  }
  const id = crypto.randomUUID();
  // This D1 belongs to the simulated LIS. A write can succeed before we lose its acknowledgement.
  try {
    await env.LIS_DB.prepare(`INSERT INTO lis_orders
      (id,idempotency_key,patient_id,test_code,payload_hash,created_at) VALUES(?,?,?,?,?,?)`)
      .bind(id,data.key,data.patientId,data.testCode,data.hash,Date.now()).run();
  } catch (error) {
    // Failure could mean the write committed, including if an ACK was dropped.
    const observed = await findRemoteOrder(env, data.key).catch(() => null);
    if (observed && observed.payload_hash === data.hash) return observed;
    throw new RemoteOutcomeUnknown(`LIS submission not confirmed: ${String(error)}`);
  }
  const remote = await findRemoteOrder(env, data.key);
  if (!remote) throw new RemoteOutcomeUnknown('LIS write outcome unknown after insert');
  const fault = await env.DB.prepare(`UPDATE demo_faults SET remaining=remaining-1
    WHERE name='drop_next_ack' AND remaining>0 RETURNING remaining`).first<{remaining:number}>();
  if (fault) throw new RemoteOutcomeUnknown('INJECTED: remote persisted the order but its acknowledgment was dropped');
  return remote;
}

export async function releaseSimulatedResult(
  env: Env, op: {id:string; idempotency_key:string}, resultText: string, unitCode: string
) {
  const remote = await findRemoteOrder(env, op.idempotency_key);
  if (!remote) throw new ApiError(409, 'not_sent', 'LIS has not received this order');
  const reportId = `demo-report:${remote.id}`;
  const resultId = `demo-result:${remote.id}`;
  const at = Date.now();
  await env.LIS_DB.batch([
    env.LIS_DB.prepare(`INSERT OR IGNORE INTO lis_results
      (id,lis_order_id,report_id,result_text,unit_code,released,released_at)
      VALUES(?,?,?,?,?,1,?)`).bind(resultId,remote.id,reportId,resultText,unitCode,at),
    env.LIS_DB.prepare("UPDATE lis_orders SET state='resulted' WHERE id=?").bind(remote.id),
  ]);
  const actual = await env.LIS_DB.prepare('SELECT id,report_id FROM lis_results WHERE lis_order_id=?')
    .bind(remote.id).first<{id:string;report_id:string}>();
  return {reportId: actual?.report_id, simulated: true, alreadyReleased: actual?.report_id !== reportId};
}

/** Injectable provider behind the shared contract; real OpenELIS will implement this contract. */
export function simulatedLisAdapter(env: Env): LaboratoryAdapter {
  return {
    manifest: {
      id: 'demo-openelis', product: 'Synthetic LIS (not OpenELIS)',
      supportedVersions: ['demo-v1'],
      capabilities: ['lab.order.create','lab.order.lookup','lab.result.poll'],
      protocol:'SIMULATOR',offlineCapable:true,
      requiresExternalIdentityProvider:false,
      conformanceSuite:'synthetic-lab-order-v1',
    },
    lookupByKey: (key) => findRemoteOrder(env,key),
    submit: (order) => sendOrder(env,{
      key:order.key,hash:order.hash,patientId:order.patientId,testCode:order.testCode,
    }),
  };
}
