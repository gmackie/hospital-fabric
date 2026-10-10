import type { Env } from './types';
import { Effect } from 'effect';
import { ApiError } from '../domain/errors';
import type { LabOrderInput } from '../domain/contracts';

const facility = 'demo-facility';
const now = () => Date.now();
const id = () => crypto.randomUUID();

/** Avoid storing clinical payloads as integration log metadata. */
async function sha256(payload: string) {
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function createPatient(env: Env, label: string) {
  const patientId = id();
  const createdAt = now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO demo_patients(id,facility_id,label,synthetic,created_at) VALUES(?,?,?,1,?)')
      .bind(patientId, facility, label.trim(), createdAt),
    env.DB.prepare('INSERT INTO audit_events(id,facility_id,actor,action,entity_type,entity_id,occurred_at) VALUES(?,?,?,?,?,?,?)')
      .bind(id(), facility, 'demo-operator', 'synthetic_patient.created', 'demo_patient', patientId, createdAt),
  ]);
  return { id: patientId, label: label.trim(), synthetic: true };
}

export type OperationRow = {
  id: string; facility_id: string; kind: string; state: string; source_system: string;
  source_resource: string; target_system: string; target_resource: string | null;
  idempotency_key: string; payload_hash: string; attempt_count: number;
  last_error: string | null; created_at: number; updated_at: number;
};

export const createLabOrder = (env: Env, input: LabOrderInput) => Effect.gen(function* () {
  const patient = yield* Effect.tryPromise({
    try: () => env.DB.prepare('SELECT id FROM demo_patients WHERE id=?').bind(input.patientId).first<{id:string}>(),
    catch: (cause) => new ApiError(500, 'db_error', String(cause)),
  });
  if (!patient) return yield* Effect.fail(new ApiError(404, 'patient_not_found', 'Synthetic patient not found'));

  // Hash canonical logical payload rather than the random operation ID.
  const payload = JSON.stringify({ patientId: input.patientId, testCode: input.testCode });
  const hash = yield* Effect.tryPromise({try: () => sha256(payload), catch: (cause) => new ApiError(500, 'hash_error', String(cause))});
  const key = `demo:${facility}:${input.requestId}`;
  const prior = yield* Effect.tryPromise({
    try: () => env.DB.prepare('SELECT id,payload_hash FROM integration_operations WHERE idempotency_key=?').bind(key).first<{id:string;payload_hash:string}>(),
    catch: (cause) => new ApiError(500, 'db_error', String(cause)),
  });
  if (prior) {
    if (prior.payload_hash !== hash) return yield* Effect.fail(new ApiError(409, 'idempotency_collision', 'requestId already used for a different order'));
    return { operationId: prior.id, duplicated: true, synthetic: true };
  }

  const opId = id(); const orderId = id(); const outboxId = id(); const at = now();
  const statements = [
    env.DB.prepare(`INSERT INTO integration_operations
      (id,facility_id,kind,source_system,source_resource,target_system,idempotency_key,payload_hash,state,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(opId,facility,'laboratory.order','demo-openmrs',`LabOrder/${orderId}`,'demo-openelis',key,hash,'queued',at,at),
    env.DB.prepare('INSERT INTO demo_lab_orders(id,patient_id,operation_id,test_code,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
      .bind(orderId,input.patientId,opId,input.testCode,'requested',at,at),
    env.DB.prepare(`INSERT INTO outbox (id,operation_id,destination,payload_json,state,available_at,created_at,updated_at)
      VALUES(?,?,?,?,'pending',?,?,?)`)
      .bind(outboxId,opId,'demo-openelis',payload,at,at,at),
    env.DB.prepare('INSERT INTO operation_events(id,operation_id,event_type,details_json,occurred_at) VALUES(?,?,?,?,?)')
      .bind(id(),opId,'order.queued','{}',at),
    env.DB.prepare('INSERT INTO audit_events(id,facility_id,actor,action,entity_type,entity_id,occurred_at) VALUES(?,?,?,?,?,?,?)')
      .bind(id(),facility,'demo-operator','synthetic_lab_order.created','operation',opId,at),
  ];
  // Atomic batch: operation + outbox + audit either all exist or none do.
  const result = yield* Effect.result(Effect.tryPromise({
    try: () => env.DB.batch(statements),
    catch: (cause) => new ApiError(500, 'db_error', String(cause)),
  }));
  if (result._tag === 'Failure') {
    // Concurrent duplicate request: reread and preserve first-write-wins.
    const existing = yield* Effect.tryPromise({
      try: () => env.DB.prepare('SELECT id,payload_hash FROM integration_operations WHERE idempotency_key=?').bind(key).first<{id:string;payload_hash:string}>(),
      catch: () => result.failure,
    });
    if (existing) {
      if (existing.payload_hash !== hash) return yield* Effect.fail(new ApiError(409, 'idempotency_collision', 'Conflicting reuse of requestId'));
      return {operationId: existing.id, duplicated: true, synthetic: true};
    }
    return yield* Effect.fail(result.failure);
  }
  return {operationId:opId, duplicated:false, synthetic:true};
});

export async function getOperation(env: Env, operationId: string) {
  return env.DB.prepare('SELECT * FROM integration_operations WHERE id=?').bind(operationId).first<OperationRow>();
}

export async function getOperationEvents(env: Env, operationId: string) {
  const { results } = await env.DB.prepare('SELECT id,event_type,details_json,occurred_at FROM operation_events WHERE operation_id=? ORDER BY occurred_at,id LIMIT 250')
    .bind(operationId).all();
  return results;
}

export async function getOrders(env: Env) {
  const {results} = await env.DB.prepare(`SELECT o.id as operation_id,o.state as operation_state,
    d.id as order_id,d.patient_id,d.test_code,d.state as order_state,o.attempt_count,o.updated_at
    FROM demo_lab_orders d JOIN integration_operations o ON d.operation_id=o.id ORDER BY d.created_at DESC LIMIT 100`).all();
  return results;
}
