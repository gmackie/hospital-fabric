/** Import one verified fixed synthetic result via OpenMRS REST; no automatic amendment. */
import{readFileSync,writeFileSync,openSync,closeSync,unlinkSync}from'node:fs';
const b='/mnt/master-apps/hospital-fabric';
const lock=b+'/private/result-return.lock';const fd=openSync(lock,'wx',0o600);
try {
const {FhirClient,inspectOpenElisTask,readSyntheticOpenMrsPatient}=await import(b+'/release/probe-client.mjs');
const file=b+'/private/lab-order-source.json',r=JSON.parse(readFileSync(file)),i=r.input;
const persist=()=>writeFileSync(file,JSON.stringify(r,null,2)+'\n',{mode:0o600});
if(r.accessionPhase!=='verified'||r.resultPhase!=='entered'||r.validationPhase!=='submitted')throw Error('Verified synthetic accession, entry and release required');
const result=new FhirClient({baseUrl:'http://127.0.0.1:18091/fhir'});
const state=await inspectOpenElisTask(result,{...i,...r.receipt});
if(state.state!=='completed'||state.reportReferences.length!==1)throw Error('Exactly one product-completed report required');
const report=await result.request(state.reportReferences[0],'DiagnosticReport');
const subject='Patient/'+i.patientId;
const coding=x=>x.code?.coding?.some(c=>c.system==='http://loinc.org'&&c.code==='718-7');
const localRef=(ref,type)=>{if(!new RegExp('^'+type+'/[0-9a-f-]{36}$','i').test(ref??''))throw Error('Invalid local product reference');return ref;};
if(report.status!=='final'||report.subject?.reference!==subject||!coding(report)||report.result?.length!==1||report.basedOn?.length!==1)throw Error('Final report profile conflict');
const analysis=await result.request(localRef(report.basedOn[0].reference,'ServiceRequest'),'ServiceRequest');
if(analysis.subject?.reference!==subject||analysis.status!=='completed'||analysis.requisition?.value!==r.accessionNumber||analysis.basedOn?.[0]?.reference!=='ServiceRequest/'+i.orderNumber||!coding(analysis))throw Error('Report analysis/accession/order correlation conflict');
const observation=await result.request(localRef(report.result[0].reference,'Observation'),'Observation');
if(observation.status!=='final'||observation.subject?.reference!==subject||!coding(observation)||observation.basedOn?.[0]?.reference!=='ServiceRequest/'+analysis.id||observation.valueQuantity?.value!==13.2||observation.valueQuantity?.unit.toLowerCase()!=='g/dl'||!observation.effectiveDateTime)throw Error('Final synthetic observation profile conflict');
const specimen=await result.request(localRef(observation.specimen?.reference,'Specimen'),'Specimen');
if(report.specimen?.[0]?.reference!=='Specimen/'+specimen.id||specimen.subject?.reference!==subject||!specimen.type?.coding?.some(c=>c.display==='Whole Blood'))throw Error('Specimen identity conflict');
const v=Object.fromEntries(readFileSync(b+'/private/deployment.env','utf8').trim().split('\n').map(x=>x.split('=')));
const authorization='Basic '+Buffer.from('admin:'+v.OMRS_ADMIN_PASSWORD).toString('base64');
const mrs=new FhirClient({baseUrl:'http://127.0.0.1:18090/openmrs/ws/fhir2/R4',authorization});
const identity=JSON.parse(readFileSync(b+'/private/openmrs-patient.json'));
const patient=await readSyntheticOpenMrsPatient(mrs,identity.identifierSystem,identity.identifier,{searchSystem:'Hospital Fabric Synthetic'});
if(patient?.id!==i.patientId||identity.identifier!==i.patientIdentifier)throw Error('Registered source identity conflict');
async function rest(path,body){const res=await fetch('http://127.0.0.1:18090/openmrs/ws/rest/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:authorization,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});if(!res.ok)throw Error('OpenMRS REST HTTP '+res.status);return res.json();}
const concepts=(await rest('concept?code=718-7&source=LOINC&v=full')).results;
if(concepts.length!==1||concepts[0].datatype?.display!=='Numeric'||concepts[0].units?.toLowerCase()!=='g/dl'||!concepts[0].mappings?.some(m=>m.display==='LOINC: 718-7'))throw Error('Explicit numeric hemoglobin mapping required');
const marker='HF synthetic order '+i.orderNumber+'; OpenELIS Observation/'+observation.id+' version '+observation.meta.versionId;
const prior=r.returnEvidence;
if(prior&&(prior.observationId!==observation.id||prior.version!==observation.meta.versionId))throw Error('Amended result requires review; refusing duplicate chart entry');
const existing=(await rest('obs?patient='+i.patientId+'&v=full&limit=100')).results;
const matches=existing.filter(o=>o.accessionNumber===r.accessionNumber&&o.comment===marker);
if(matches.length>1)throw Error('Duplicate chart results require review');
let obs=matches[0];
if(!obs){
 if(r.returnPhase==='submission_started'||prior)throw Error('Prior chart outcome unknown; reconcile before any write');
 r.returnPhase='submission_started';r.returnEvidence={observationId:observation.id,version:observation.meta.versionId,reportId:report.id,accessionNumber:r.accessionNumber};persist();
 obs=await rest('obs',{person:i.patientId,concept:concepts[0].uuid,obsDatetime:observation.effectiveDateTime,value:13.2,accessionNumber:r.accessionNumber,comment:marker});
}
const saved=await rest('obs/'+obs.uuid+'?v=full');
if(saved.person?.uuid!==i.patientId||saved.concept?.uuid!==concepts[0].uuid||saved.value!==13.2||saved.accessionNumber!==r.accessionNumber||saved.comment!==marker||saved.voided)throw Error('Persisted chart result conflict');
const fhir=await mrs.request('Observation/'+obs.uuid,'Observation');
if(fhir.subject?.reference!==subject||fhir.valueQuantity?.value!==13.2)throw Error('FHIR chart verification conflict');
r.returnPhase='verified';r.returnEvidence={observationId:observation.id,version:observation.meta.versionId,reportId:report.id,accessionNumber:r.accessionNumber,openMrsObsId:obs.uuid,verifiedAt:new Date().toISOString()};persist();
console.log(JSON.stringify({returned:true,...r.returnEvidence,patientId:i.patientId,value:13.2,units:'g/dL',scope:'fixed synthetic validated result; amendments held for review'},null,2));
}finally{closeSync(fd);unlinkSync(lock);}
