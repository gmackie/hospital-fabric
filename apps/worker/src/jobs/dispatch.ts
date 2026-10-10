import { Effect } from 'effect';
import type { Env } from '../db/types';
import { simulatedLisAdapter } from '../adapters/lis-simulator';
import { ReconciliationRequired } from '../domain/errors';

type Pending = {
  id: string; operation_id: string; state: string; attempts: number; idempotency_key: string;
  payload_hash: string; patient_id: string; test_code: string; lease_token: string | null;
};

const selectDue = `SELECT b.id,b.operation_id,b.state,b.attempts,b.lease_token,
  o.idempotency_key,o.payload_hash,d.patient_id,d.test_code
  FROM outbox b
  JOIN integration_operations o ON o.id=b.operation_id
  JOIN demo_lab_orders d ON d.operation_id=o.id
  WHERE ((b.state IN ('pending','retry','uncertain') AND b.available_at<=?)
    OR (b.state='processing' AND b.lease_until<=?))
  AND (? IS NULL OR b.operation_id=?)
  AND (? IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public_demo_sessions s WHERE s.operation_id=b.operation_id))
  ORDER BY b.created_at LIMIT 1`;

async function claim(env: Env, operationId?: string): Promise<Pending | null> {
  const at = Date.now();
  const due = await env.DB.prepare(selectDue).bind(at,at,operationId??null,operationId??null,operationId??null).first<Pending>();
  if (!due) return null;
  const token = crypto.randomUUID();
  const leaseUntil = at + 30_000;
  const claimed = await env.DB.prepare(`UPDATE outbox
    SET state='processing',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
    WHERE id=? AND ((state IN ('pending','retry','uncertain') AND available_at<=?)
    OR (state='processing' AND lease_until<=?)) RETURNING id`)
    .bind(token,leaseUntil,at,due.id,at,at).first<{id:string}>();
  if (!claimed) return null;
  await env.DB.prepare("UPDATE integration_operations SET state='dispatching', attempt_count=attempt_count+1,updated_at=? WHERE id=? AND state NOT IN ('accepted','completed')")
    .bind(at,due.operation_id).run();
  const item = { ...due, lease_token: token };
  await recordEvent(env, item, 'delivery.attempt_started', {attempt: due.attempts + 1});
  return item;
}

/** Persist integration metadata only, fenced to the active delivery attempt. */
async function recordEvent(env: Env, item: Pending, type: string, details: Record<string, unknown>) {
  await env.DB.prepare(`INSERT INTO operation_events(id,operation_id,event_type,details_json,occurred_at)
    SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM outbox WHERE id=? AND lease_token=? AND state='processing')`)
    .bind(crypto.randomUUID(),item.operation_id,type,JSON.stringify(details),Date.now(),item.id,item.lease_token).run();
}

/** Every related write is conditional on the lease. A stale worker must not finalize the order. */
async function accepted(env: Env, item: Pending, remoteId: string) {
  const at = Date.now();
  const gate = `EXISTS(SELECT 1 FROM outbox WHERE id=? AND lease_token=? AND state='processing')`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE integration_operations SET state='accepted',target_resource=?,last_error=NULL,updated_at=? WHERE id=? AND ${gate}`)
      .bind(`LisOrder/${remoteId}`,at,item.operation_id,item.id,item.lease_token),
    env.DB.prepare(`UPDATE demo_lab_orders SET state='accepted',updated_at=? WHERE operation_id=? AND ${gate}`)
      .bind(at,item.operation_id,item.id,item.lease_token),
    env.DB.prepare(`INSERT OR IGNORE INTO operation_events(id,operation_id,event_type,details_json,occurred_at)
      SELECT ?,?,?,?,? WHERE ${gate}`)
      .bind(`event:accepted:${item.operation_id}`,item.operation_id,'order.accepted',JSON.stringify({externalRef:`LisOrder/${remoteId}`}),at,item.id,item.lease_token),
    env.DB.prepare(`UPDATE reconciliation_cases SET state='resolved',resolution='verified_remote_order',updated_at=?
      WHERE operation_id=? AND ${gate}`)
      .bind(at,item.operation_id,item.id,item.lease_token),
    env.DB.prepare(`UPDATE outbox SET state='delivered',lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND lease_token=? AND state='processing'`).bind(at,item.id,item.lease_token),
  ]);
}

async function uncertain(env: Env,item: Pending,error: unknown) {
  const at = Date.now();
  const gate = `EXISTS(SELECT 1 FROM outbox WHERE id=? AND lease_token=? AND state='processing')`;
  if (item.attempts >= 8) {
    await blocked(env, item, new Error('Repeated ambiguous outcome: manual review required'));
    return;
  }
  const retryAt = at + Math.min(60000, 1000 * 2 ** Math.min(item.attempts, 6));
  await env.DB.batch([
    env.DB.prepare(`UPDATE integration_operations SET state='outcome_unknown' ,last_error=?,updated_at=? WHERE id=? AND ${gate}`)
      .bind(String(error).slice(0,400),at,item.operation_id,item.id,item.lease_token),
    env.DB.prepare(`INSERT INTO reconciliation_cases(id,operation_id,reason,state,opened_at,updated_at)
      SELECT ?,?,'acknowledgment_missing','open',?,? WHERE ${gate}
      ON CONFLICT(operation_id) DO UPDATE SET reason='acknowledgment_missing',state='open',updated_at=excluded.updated_at`)
      .bind(`case:${item.operation_id}`,item.operation_id,at,at,item.id,item.lease_token),
    env.DB.prepare(`INSERT OR IGNORE INTO operation_events(id,operation_id,event_type,details_json,occurred_at)
      SELECT ?,?,'order.outcome_unknown',?,? WHERE ${gate}`)
      .bind(`event:unknown:${item.lease_token}`,item.operation_id,JSON.stringify({reason:'destination acknowledgment unavailable'}),at,item.id,item.lease_token),
    env.DB.prepare(`UPDATE outbox SET state='uncertain',available_at=?,lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND lease_token=? AND state='processing'`).bind(retryAt,at,item.id,item.lease_token),
  ]);
}

async function blocked(env: Env,item: Pending,error: unknown) {
  await recordEvent(env, item, 'order.needs_review', {reason: 'conflict_or_repeated_ambiguity'});
  const at=Date.now();
  const gate = `EXISTS(SELECT 1 FROM outbox WHERE id=? AND lease_token=? AND state='processing')`;
  await env.DB.batch([
    env.DB.prepare(`UPDATE integration_operations SET state='needs_review',last_error=?,updated_at=? WHERE id=? AND ${gate}`)
      .bind(String(error).slice(0,400),at,item.operation_id,item.id,item.lease_token),
    env.DB.prepare(`UPDATE demo_lab_orders SET state='needs_review',updated_at=? WHERE operation_id=? AND ${gate}`)
      .bind(at,item.operation_id,item.id,item.lease_token),
    env.DB.prepare(`INSERT INTO reconciliation_cases(id,operation_id,reason,state,opened_at,updated_at)
      SELECT ?,?,'manual_review_required','manual_review',?,? WHERE ${gate}
      ON CONFLICT(operation_id) DO UPDATE SET reason='manual_review_required',state='manual_review',updated_at=excluded.updated_at`)
      .bind(`case:${item.operation_id}`,item.operation_id,at,at,item.id,item.lease_token),
    env.DB.prepare(`UPDATE outbox SET state='blocked',lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND lease_token=? AND state='processing'`).bind(at,item.id,item.lease_token),
  ]);
}

export const dispatchOnce = (env: Env, operationId?: string) => Effect.gen(function* () {
  const item = yield* Effect.promise(() => claim(env, operationId));
  if (!item) return { ran: false, state: 'empty' };
  const attempt = yield* Effect.result(Effect.tryPromise({
    try: async () => {
      // Reconcile before sending: prior attempts may have committed remotely.
      const adapter = simulatedLisAdapter(env);
      await recordEvent(env, item, 'delivery.lookup_started', {attempt: item.attempts + 1});
      const existing = await adapter.lookupByKey(item.idempotency_key);
      await recordEvent(env, item, 'delivery.lookup_completed', {found: !!existing});
      if (!existing) await recordEvent(env, item, 'delivery.submit_started', {attempt: item.attempts + 1});
      const remote = existing ?? await adapter.submit({
        key: item.idempotency_key, hash: item.payload_hash,
        patientId: item.patient_id, testCode: item.test_code,
      });
      if (remote.payload_hash !== item.payload_hash) {
        throw new ReconciliationRequired('Destination order conflicts with source');
      }
      await recordEvent(env, item, existing ? 'delivery.reconciled' : 'delivery.acknowledged', {externalRef: `LisOrder/${remote.id}`});
      await accepted(env, item, remote.id);
      return remote.id;
    },
    catch: (cause) => cause,
  }));
  if (attempt._tag === 'Success') return { ran:true, state:'accepted', operationId:item.operation_id };
  const error = attempt.failure;
  if (error instanceof ReconciliationRequired) {
    yield* Effect.promise(() => blocked(env, item, error));
    return { ran:true, state:'needs_review', operationId:item.operation_id };
  }
  yield* Effect.promise(() => uncertain(env, item, error));
  return { ran:true, state:item.attempts >= 8 ? 'needs_review' : 'outcome_unknown', operationId:item.operation_id };
});

/** Prefer a small bounded sweep. The cron and admin endpoint share the same safe claim logic. */
export async function runDispatchBatch(env: Env, limit=10, operationId?: string) {
  const outcomes: Array<{ran:boolean;state:string;operationId?:string}> = [];
  for (let i=0;i<limit;i++) {
    const result = await Effect.runPromise(dispatchOnce(env, operationId));
    if (!result.ran) break;
    outcomes.push(result);
    // Expose uncertain outcomes for inspection; do not retry them in this same sweep.
    if (result.state === 'outcome_unknown' || result.state === 'needs_review') break;
  }
  return outcomes;
}

/** A selected-operation action must never dispatch an unrelated due order. */
export async function reconcileOperation(env: Env, operationId: string) {
  const result = await Effect.runPromise(dispatchOnce(env, operationId));
  return result.ran ? [result] : [];
}
