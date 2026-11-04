import { choice, fields, integer, requireThat, syntheticId } from './protocol.js';
export const TESTS = ['hemoglobin', 'cbc', 'electrolytes', 'renal', 'blood-gas', 'microbiology'] as const;
export type TestCode = typeof TESTS[number];
export type LabOrder = {
  id:string; patientId:string; specimenId:string; referringFacility:string; test:TestCode;
  status:'ordered'|'received'|'processing'|'cancelled'|'released'; custody:{action:string;at:number;actor:string}[];
  reports:LabReport[];
};
export type LabReport = {
  revision:number; status:'preliminary'|'final'|'amended'; critical:boolean;
  components:{code:string;value:string;unit:string}[]; releasedAt:number; acknowledgedBy:string|null;
};
/** Local demonstration codes; deliberately NOT asserted to be LOINC mappings. */
export const COMPONENTS: Record<TestCode, readonly string[]> = {
  hemoglobin:['HB-DEMO'],cbc:['WBC-DEMO','HB-DEMO','PLT-DEMO'],
  electrolytes:['NA-DEMO','K-DEMO','CL-DEMO'],renal:['UREA-DEMO','CREAT-DEMO'],
  'blood-gas':['PH-DEMO','PCO2-DEMO','PO2-DEMO'],
  microbiology:['GRAM-DEMO','ORGANISM-DEMO','SUSCEPTIBILITY-DEMO'],
};
export function syntheticReport(test:TestCode,revision:number,status:LabReport['status'],critical:boolean,minute:number):LabReport {
  return {revision,status,critical,components:COMPONENTS[test].map(code=>({code,value:'SYNTHETIC',unit:'demo'})),releasedAt:minute,acknowledgedBy:null};
}
export function serviceRequest(order:LabOrder) {
  return {resourceType:'ServiceRequest',id:order.id,status:order.status==='cancelled'?'revoked':order.status==='released'?'completed':'active',intent:'order',
    meta:{tag:[{system:'urn:hospital-fabric:mode',code:'synthetic'}]},
    identifier:[{system:'urn:hospital-fabric:lab-order',value:order.id}],
    subject:{reference:`Patient/${order.patientId}`},specimen:[{reference:`Specimen/${order.specimenId}`}],
    code:{coding:[{system:'urn:hospital-fabric:demo-test',code:order.test}]}};
}
export function reportBundle(order:LabOrder,report:LabReport) {
  const reportId = `${order.id}-R${report.revision}`;
  return {resourceType:'Bundle',type:'collection',entry:[
    {resource:{resourceType:'DiagnosticReport',id:reportId,status:report.status,
      meta:{versionId:String(report.revision),tag:[{system:'urn:hospital-fabric:mode',code:'synthetic'}]},
      code:{coding:[{system:'urn:hospital-fabric:demo-test',code:order.test}]},
      subject:{reference:`Patient/${order.patientId}`},basedOn:[{reference:`ServiceRequest/${order.id}`}],specimen:[{reference:`Specimen/${order.specimenId}`}],
      result:report.components.map((_,i)=>({reference:`Observation/${reportId}-${i}`}))}},
    ...report.components.map((component,i)=>({resource:{resourceType:'Observation',id:`${reportId}-${i}`,status:report.status,
      subject:{reference:`Patient/${order.patientId}`},specimen:{reference:`Specimen/${order.specimenId}`},
      code:{coding:[{system:'urn:hospital-fabric:demo-component',code:component.code}]},valueString:component.value}})),
  ]};
}
/** Explicit simulation intake contract: exact correlation; never fuzzy-match a result. */
export function intake(input:unknown,order:LabOrder):LabReport {
  const o=fields(input,['orderId','patientId','specimenId','test','revision','status','critical','components']);
  requireThat(syntheticId(o.orderId)===order.id && syntheticId(o.patientId)===order.patientId && syntheticId(o.specimenId)===order.specimenId,'result_correlation_mismatch');
  requireThat(choice(o.test,TESTS)===order.test,'test_mismatch');
  const revision=integer(o.revision,1,100),status=choice(o.status,['preliminary','final','amended'] as const);
  requireThat(typeof o.critical==='boolean','invalid_critical_flag');
  requireThat(Array.isArray(o.components)&&o.components.length===COMPONENTS[order.test].length,'panel_incomplete');
  const components=(o.components as unknown[]).map(v=>{
    const c=fields(v,['code','value','unit']);
    requireThat(typeof c.code==='string' && COMPONENTS[order.test].includes(c.code),'component_mismatch');
    requireThat(c.value==='SYNTHETIC' && c.unit==='demo','synthetic_results_only');
    return {code:c.code as string,value:'SYNTHETIC',unit:'demo'};
  }).sort((a,b)=>a.code<b.code?-1:a.code>b.code?1:0);
  requireThat(new Set(components.map(c=>c.code)).size===components.length,'duplicate_component');
  return {revision,status,critical:o.critical as boolean,components,releasedAt:0,acknowledgedBy:null};
}
/** Import the deliberately narrow FHIR R4 synthetic profile exported above.
 * Real-product catalogs, auth and capability discovery remain separate commissioning gates.
 */
export function fromFhirBundle(value:unknown,order:LabOrder,critical:boolean):LabReport {
  const bundle=fields(value,['resourceType','type','entry']);
  requireThat(bundle.resourceType==='Bundle'&&bundle.type==='collection'&&Array.isArray(bundle.entry),'invalid_fhir_bundle');
  requireThat(bundle.entry.length<=16,'fhir_bundle_limit');
  const resources=(bundle.entry as unknown[]).map(e=>fields(e,['resource']).resource).map(r=>fields(r,['resourceType','id'],['status','meta','code','subject','basedOn','specimen','result','valueString']));
  const reports=resources.filter(r=>r.resourceType==='DiagnosticReport');requireThat(reports.length===1,'one_diagnostic_report_required');
  const report=reports[0]!;const meta=fields(report.meta,['versionId','tag']);
  requireThat(Array.isArray(meta.tag)&&meta.tag.some(v=>{const t=fields(v,['system','code']);return t.system==='urn:hospital-fabric:mode'&&t.code==='synthetic';}),'synthetic_fhir_only');
  const revision=integer(Number(meta.versionId),1,100);
  const reference=(v:unknown)=>fields(v,['reference']).reference;
  requireThat(reference(report.subject)===`Patient/${order.patientId}`,'fhir_patient_mismatch');
  requireThat(Array.isArray(report.basedOn)&&report.basedOn.length===1&&reference(report.basedOn[0])===`ServiceRequest/${order.id}`,'fhir_order_mismatch');
  requireThat(Array.isArray(report.specimen)&&report.specimen.length===1&&reference(report.specimen[0])===`Specimen/${order.specimenId}`,'fhir_specimen_mismatch');
  const coding=(v:unknown,system:string)=>{const c=fields(v,['coding']);requireThat(Array.isArray(c.coding)&&c.coding.length===1,'single_demo_code_required');const k=fields(c.coding[0],['system','code']);requireThat(k.system===system,'coding_system_mismatch');return k.code;};
  requireThat(coding(report.code,'urn:hospital-fabric:demo-test')===order.test,'fhir_test_mismatch');
  requireThat(Array.isArray(report.result),'fhir_result_references_required');
  const observations=resources.filter(r=>r.resourceType==='Observation');
  requireThat(new Set(resources.map(r=>`${r.resourceType}/${r.id}`)).size===resources.length,'duplicate_fhir_resource');
  requireThat(resources.length===observations.length+1&&report.result.length===observations.length,'unexpected_fhir_resources');
  const refs=(report.result as unknown[]).map(reference);requireThat(new Set(refs).size===refs.length,'duplicate_fhir_result_reference');
  const components=refs.map(ref=>{const o=observations.find(o=>`Observation/${o.id}`===ref);requireThat(o,'missing_fhir_observation');requireThat(reference(o.subject)===`Patient/${order.patientId}`&&reference(o.specimen)===`Specimen/${order.specimenId}`,'observation_correlation_mismatch');requireThat(o.status===report.status,'observation_status_mismatch');return {code:coding(o.code,'urn:hospital-fabric:demo-component'),value:o.valueString,unit:'demo'};});
  return intake({orderId:order.id,patientId:order.patientId,specimenId:order.specimenId,test:order.test,revision,status:report.status,critical,components},order);
}
