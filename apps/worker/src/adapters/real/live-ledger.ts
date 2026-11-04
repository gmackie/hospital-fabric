import { FhirProtocolError } from './fhir-client';
import { reconcileLiveOrder, stageLiveOrder, type LabConnection, type LabRequest, type RemoteOrder } from './live-lab';
import type { ChartJournal } from './live-chart';

/** This module is for a PRIVATE local D1 binding, never the public demo D1. */
type Result={meta?:{changes?:number};results?:Array<Record<string,unknown>>};
type Statement={bind(...values:(string|number|null)[]):Statement;first<T>():Promise<T|null>;run():Promise<Result>};
export type LocalDb={prepare(sql:string):Statement;batch(statements:Statement[]):Promise<Result[]>};
type Intent={order_number:string;fingerprint:string;state:string;request_id:string|null;task_id:string|null};
const hex=async(text:string)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const stable=(input:LabRequest)=>JSON.stringify([
 input.orderNumber,input.patientId,input.patientIdentifierSystem,input.patientIdentifier,input.ownerId,
 input.authoredOn,input.testKey
]);
export class PrivateLabLedger implements ChartJournal {
  constructor(private readonly db:LocalDb){}
  async begin(key:string,fingerprint:string):Promise<'new'|'in_flight'|'completed'|'conflict'>{
    const r=await this.db.prepare("INSERT OR IGNORE INTO live_chart_writes (key,fingerprint,state) VALUES (?,?,'started')").bind(key,fingerprint).run();
    if(r.meta?.changes===1)return 'new';
    const old=await this.db.prepare("SELECT fingerprint,state FROM live_chart_writes WHERE key=?").bind(key).first<{fingerprint:string;state:string}>();
    if(!old||old.fingerprint!==fingerprint)return 'conflict';
    return old.state==='completed'?'completed':'in_flight';
  }
  async complete(key:string,sourceObservationId:string,chartObservationId:string):Promise<void>{
    const r=await this.db.prepare("UPDATE live_chart_writes SET state='completed',source_observation_id=?,chart_observation_id=? WHERE key=? AND state='started'").bind(sourceObservationId,chartObservationId,key).run();
    if(r.meta?.changes!==1)throw new FhirProtocolError('Chart ledger completion state conflict');
  }
  async claimOrder(input:LabRequest):Promise<'new'|'existing'>{
    const fingerprint=await hex(stable(input));
    const r=await this.db.prepare("INSERT OR IGNORE INTO live_lab_orders (order_number,fingerprint,patient_ref,test_key,state) VALUES (?,?,?,?,'pending')").bind(input.orderNumber,fingerprint,input.patientId,input.testKey).run();
    if(r.meta?.changes===1)return 'new';
    const old=await this.db.prepare("SELECT fingerprint FROM live_lab_orders WHERE order_number=?").bind(input.orderNumber).first<{fingerprint:string}>();
    if(old?.fingerprint!==fingerprint)throw new FhirProtocolError('External order identifier was reused with different source data');
    return 'existing';
  }
  async getOrder(number:string):Promise<Intent|null>{
    return this.db.prepare("SELECT order_number,fingerprint,state,request_id,task_id FROM live_lab_orders WHERE order_number=?").bind(number).first<Intent>();
  }
  async markStarted(number:string):Promise<void>{
    const r=await this.db.prepare("UPDATE live_lab_orders SET state='submission_started' WHERE order_number=? AND state='pending'").bind(number).run();
    if(r.meta?.changes!==1)throw new FhirProtocolError('Concurrent or previously submitted order requires reconciliation');
  }
  async markUnknown(number:string):Promise<void>{
    await this.db.prepare("UPDATE live_lab_orders SET state='outcome_unknown' WHERE order_number=? AND state='submission_started'").bind(number).run();
  }
  async markRemote(number:string,remote:RemoteOrder):Promise<void>{
    const r=await this.db.prepare("UPDATE live_lab_orders SET state=?,request_id=?,task_id=? WHERE order_number=? AND state IN ('pending','submission_started','outcome_unknown','awaiting_lab','accepted','needs_review','completed')").bind(remote.state,remote.requestId,remote.taskId,number).run();
    if(r.meta?.changes!==1)throw new FhirProtocolError('Remote order could not be recorded');
  }
  async recordResult(number:string,reportId:string,version:string,status:string,digest:string):Promise<'new'|'existing'>{
    if(!/^[a-f0-9]{64}$/.test(digest))throw new FhirProtocolError('Report digest must be SHA-256');
    const result=await this.db.prepare("INSERT OR IGNORE INTO live_lab_report_versions (order_number,report_id,version,status,digest) VALUES (?,?,?,?,?)").bind(number,reportId,version,status,digest).run();
    if(result.meta?.changes===1)return 'new';
    const prior=await this.db.prepare("SELECT status,digest FROM live_lab_report_versions WHERE order_number=? AND report_id=? AND version=?").bind(number,reportId,version).first<{status:string;digest:string}>();
    if(!prior||prior.digest!==digest||prior.status!==status)throw new FhirProtocolError('Amended report replaced the same version; manual review');
    return 'existing';
  }
}
/** At-least-once source scanning, but never a second order POST after an unknown outcome. */
export async function dispatchPrivateOrder(config:LabConnection,ledger:PrivateLabLedger,input:LabRequest):Promise<RemoteOrder>{
  const claim=await ledger.claimOrder(input);
  const remote=await reconcileLiveOrder(config.source,config.catalog,input);
  if(remote){await ledger.markRemote(input.orderNumber,remote);return remote;}
  const prior=await ledger.getOrder(input.orderNumber);
  if(claim!=='new'||prior?.state!=='pending')throw new FhirProtocolError('Remote outcome unresolved; do not resubmit without manual reconciliation');
  await ledger.markStarted(input.orderNumber);
  try {
    const created=await stageLiveOrder(config,input);
    await ledger.markRemote(input.orderNumber,created);
    return created;
  } catch {
    await ledger.markUnknown(input.orderNumber);
    throw new FhirProtocolError('Order may have committed; exact remote reconciliation required');
  }
}
