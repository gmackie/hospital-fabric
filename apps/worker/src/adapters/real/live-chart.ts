import { FhirClient, FhirProtocolError, type FhirResource } from './fhir-client';
import type { ReleasedReport, ResultEntry } from './live-lab';

/** Narrow OpenMRS REST bridge for validated numeric results.
 * All writes require an isolated, approved SYNTHETIC instance and durable journal.
 * A result already in the chart is reconciled, never blindly written twice.
 */
export interface ChartJournal {
  /** Persist an immutable intent BEFORE the network write; returns current state. */
  begin(key: string, fingerprint: string): Promise<'new'|'in_flight'|'completed'|'conflict'>;
  complete(key: string, sourceObservationId: string, chartObservationId: string): Promise<void>;
}
export type ChartConfig={
  restBaseUrl:string;
  authorization:string;
  fetch?:typeof fetch;
  /** A reviewed, installed OpenMRS concept mapping for each LOINC, not a guess. */
  conceptMap:Readonly<Record<string, {uuid:string;units:string;datatype:'Numeric'}>>;
  allowSyntheticChartWrites:boolean;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safe=(s:string)=>encodeURIComponent(s);
const object=(v:unknown):Record<string,unknown>=>{
  if(!v||typeof v!=='object'||Array.isArray(v))throw new FhirProtocolError('Invalid OpenMRS response');
  return v as Record<string,unknown>;
};
function createRestClient(config:ChartConfig){
  const base=new URL(config.restBaseUrl.replace(/\/$/,'')+'/');
  if(base.username||base.password||base.search||base.hash ||
    !(base.protocol==='https:' || (base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname))))
    throw new FhirProtocolError('Unsafe private OpenMRS REST address');
  async function request(path:string, body?:unknown):Promise<Record<string,unknown>> {
    if(!/^[A-Za-z][A-Za-z0-9]*(?:\/[A-Za-z0-9.-]+)?(?:\?[^#]*)?$/.test(path))throw new FhirProtocolError('Unsafe REST path');
    const uri=new URL(path,base);
    if(uri.origin!==base.origin||!uri.pathname.startsWith(base.pathname))throw new FhirProtocolError('REST path escaped configured service');
    let response:Response;
    try{response=await(config.fetch??fetch)(uri,{method:body?'POST':'GET',headers:{
      Authorization:config.authorization,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})
    },body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(15_000)});}
    catch{throw new FhirProtocolError('OpenMRS REST outcome unknown; verify chart before another write');}
    if(!response.ok)throw new FhirProtocolError('OpenMRS REST returned HTTP '+response.status);
    if(!['application/json','application/fhir+json'].includes(response.headers.get('content-type')?.split(';')[0]?.trim()??''))throw new FhirProtocolError('Invalid OpenMRS REST content type');
    const raw=await response.text();if(raw.length>1_048_576)throw new FhirProtocolError('OpenMRS REST response exceeded limit');
    try{return object(JSON.parse(raw));}catch{throw new FhirProtocolError('OpenMRS REST JSON invalid');}
  }
  return request;
}
export function chartKey(report:ReleasedReport,obs:ResultEntry):string {
  return [report.orderNumber,report.accessionNumber,report.id,report.version,obs.resourceId,obs.version].join('|');
}
export function chartMarker(report:ReleasedReport,obs:ResultEntry):string {
  return 'HF synthetic order '+report.orderNumber+'; OpenELIS Observation/'+obs.resourceId+' version '+obs.version;
}
export function validateChartResult(report:ReleasedReport,obs:ResultEntry,config:ChartConfig) {
  if(!config.allowSyntheticChartWrites)throw new FhirProtocolError('Synthetic chart import permission missing');
  if(!report.orderNumber.startsWith('HF-SYNTH-'))throw new FhirProtocolError('Synthetic order number required');
  if(!UUID.test(report.patientId))throw new FhirProtocolError('Chart patient ID is not a FHIR UUID');
  if(!UUID.test(obs.resourceId))throw new FhirProtocolError('Chart result observation ID is not a FHIR UUID');
  if(!UUID.test(report.id))throw new FhirProtocolError('Chart report ID is not a FHIR UUID');
  if(!report.accessionNumber||report.status!=='final')
    throw new FhirProtocolError('Only final reports with verified accession may enter chart');
  if(!obs.effectiveDateTime||!Number.isFinite(Date.parse(obs.effectiveDateTime)))
    throw new FhirProtocolError('Valid observation collection time required');
  if(obs.value.kind!=='quantity'||!Number.isFinite(obs.value.value)||
     obs.value.system!=='http://unitsofmeasure.org')
    throw new FhirProtocolError('Numeric UCUM-encoded result required for this chart writer');
  const mapping=config.conceptMap[obs.loinc];
  if(!mapping||!UUID.test(mapping.uuid)||mapping.datatype!=='Numeric'||
     mapping.units.toLowerCase()!==obs.value.code.toLowerCase())
    throw new FhirProtocolError('No reviewed exact numeric OpenMRS concept/unit mapping');
  return mapping;
}
export async function reconcileChartObservation(config:ChartConfig,report:ReleasedReport,obs:ResultEntry,
                                                expectedConceptId:string):Promise<string|null> {
  const rest=createRestClient(config),result=await rest('obs?patient='+safe(report.patientId)+'&v=full&limit=100');
  const list=result.results;
  if(!Array.isArray(list)||list.length>=100)throw new FhirProtocolError('Chart observation history is incomplete; manual reconciliation');
  const marker=chartMarker(report,obs);
  const matches=list.map(object).filter(r=>r.accessionNumber===report.accessionNumber&&r.comment===marker);
  if(matches.length>1)throw new FhirProtocolError('Duplicate chart observations require review');
  if(matches.length===0)return null;
  const row=matches[0]!;
  if(object(row.person).uuid!==report.patientId||object(row.concept).uuid!==expectedConceptId||
     row.voided===true||row.value!==(obs.value.kind==='quantity'?obs.value.value:null)||
     typeof row.uuid!=='string'||!UUID.test(row.uuid))
    throw new FhirProtocolError('Existing chart observation has conflicting content');
  return row.uuid;
}
export async function verifyChartConcept(config:ChartConfig,code:string,uuid:string,unit:string):Promise<void> {
  const rest=createRestClient(config);
  const matches=await rest('concept?code='+safe(code)+'&source=LOINC&v=full');
  const concepts=matches.results;
  if(!Array.isArray(concepts)||concepts.length!==1)throw new FhirProtocolError('Installed concept mapping is ambiguous');
  const concept=object(concepts[0]);
  if(concept.uuid!==uuid||object(concept.datatype).display!=='Numeric'||
     String(concept.units??'').toLowerCase()!==unit.toLowerCase()||
     !Array.isArray(concept.mappings)||
     !concept.mappings.some(v=>object(v).display==='LOINC: '+code))
     throw new FhirProtocolError('Installed concept mapping or unit does not match approved mapping');
}
/** Write exactly once in an authorized synthetic sandbox. Amendments go to human review. */
export async function importNumericChartResult(config:ChartConfig,openMrs:FhirClient,journal:ChartJournal,
                                               report:ReleasedReport,obs:ResultEntry):Promise<{state:'existing'|'imported';id:string}> {
  const mapping=validateChartResult(report,obs,config);
  const patient=await openMrs.request('Patient/'+report.patientId,'Patient');
  if(patient.id!==report.patientId||!(patient.identifier as Array<{value?:string}>|undefined)?.some(x=>x.value?.startsWith('HF-SYNTH-')))
    throw new FhirProtocolError('Synthetic chart patient identity not verified');
  await verifyChartConcept(config,obs.loinc,mapping.uuid,mapping.units);
  const existing=await reconcileChartObservation(config,report,obs,mapping.uuid);
  if(existing)return {state:'existing',id:existing};
  const key=chartKey(report,obs);
  const fingerprint=[report.patientId,mapping.uuid,JSON.stringify(obs.value),obs.effectiveDateTime].join('|');
  const state=await journal.begin(key,fingerprint);
  if(state==='conflict'||state==='in_flight'||state==='completed')
    throw new FhirProtocolError('Prior chart write outcome must be reconciled manually before resubmission');
  // begin() must be durable before this HTTP request. On timeout, do not repeat POST.
  const rest=createRestClient(config);
  const saved=await rest('obs',{person:report.patientId,concept:mapping.uuid,
    obsDatetime:obs.effectiveDateTime,value:obs.value.kind==='quantity'?obs.value.value:null,
    accessionNumber:report.accessionNumber,comment:chartMarker(report,obs)});
  if(typeof saved.uuid!=='string'||!UUID.test(saved.uuid))throw new FhirProtocolError('Uncertain OpenMRS chart write');
  const check=await reconcileChartObservation(config,report,obs,mapping.uuid);
  if(check!==saved.uuid)throw new FhirProtocolError('OpenMRS chart write not verified');
  const fhir=await openMrs.request('Observation/'+saved.uuid,'Observation');
  if(fhir.resourceType!=='Observation'||(fhir.subject as {reference?:string}|undefined)?.reference!=='Patient/'+report.patientId)
    throw new FhirProtocolError('FHIR chart correlation check failed');
  await journal.complete(key,obs.resourceId,saved.uuid);
  return {state:'imported',id:saved.uuid};
}
