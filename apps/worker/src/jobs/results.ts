import type { Env } from '../db/types';

type RemoteResult = {
  id:string; report_id:string; result_text:string; unit_code:string; released_at:number;
  idempotency_key:string; patient_id:string; test_code:string;
};

/** Simulated LIS result intake. This is NOT a clinical result validation pipeline. */
export async function pollResults(env: Env, limit=25) {
  const remote = await env.LIS_DB.prepare(`SELECT r.*,o.idempotency_key,o.patient_id,o.test_code
    FROM lis_results r JOIN lis_orders o ON o.id=r.lis_order_id
    ORDER BY r.released_at LIMIT ?`).bind(limit).all<RemoteResult>();
  let processed = 0, skipped = 0, quarantined = 0;
  for (const result of remote.results) {
    const existing = await env.DB.prepare('SELECT payload_hash FROM inbox WHERE source_system=? AND dedupe_key=?')
      .bind('demo-openelis', result.report_id).first<{payload_hash:string}>();
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({
      text:result.result_text,units:result.unit_code,reportId:result.report_id
    })));
    const hash = [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
    if (existing) {
      if (existing.payload_hash !== hash) quarantined++;
      else skipped++;
      continue;
    }
    const op = await env.DB.prepare(`SELECT o.id,d.patient_id,d.test_code FROM integration_operations o
      JOIN demo_lab_orders d ON d.operation_id=o.id
      WHERE o.idempotency_key=?`).bind(result.idempotency_key)
      .first<{id:string;patient_id:string;test_code:string}>();
    if (!op || op.patient_id!==result.patient_id || op.test_code!==result.test_code) {
      // Do not silently attach an unmatched result to a chart.
      quarantined++;
      continue;
    }
    const at=Date.now();
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO inbox(id,source_system,dedupe_key,payload_hash,state,received_at,processed_at) VALUES(?,?,?,?,?,?,?)')
        .bind(`inbox:${result.report_id}`,'demo-openelis',result.report_id,hash,'processed',at,at),
      env.DB.prepare(`INSERT OR IGNORE INTO demo_chart_results
        (id,patient_id,operation_id,source_report_id,test_code,result_text,unit_code,simulated,created_at)
        VALUES(?,?,?,?,?,?,?,1,?)`)
        .bind(`chart:${result.report_id}`,op.patient_id,op.id,result.report_id,result.test_code,result.result_text,result.unit_code,at),
      env.DB.prepare("UPDATE demo_lab_orders SET state='completed',updated_at=? WHERE operation_id=?")
        .bind(at,op.id),
      env.DB.prepare("UPDATE integration_operations SET state='completed',updated_at=? WHERE id=? AND state IN ('accepted','completed')")
        .bind(at,op.id),
      env.DB.prepare(`INSERT OR IGNORE INTO operation_events(id,operation_id,event_type,details_json,occurred_at) VALUES(?,?,?,?,?)`)
        .bind(`event:result:${result.report_id}`,op.id,'result.imported',JSON.stringify({reportId:result.report_id,synthetic:true}),at),
    ]);
    processed++;
  }
  return {processed,skipped,quarantined};
}
