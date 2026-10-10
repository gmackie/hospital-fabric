/** Private live create-only transaction check. Uses generated synthetic fixtures only. */
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const base='/mnt/master-apps/hospital-fabric';
const {FhirClient}=await import(base+'/release/probe-client.mjs');
const client=new FhirClient({baseUrl:'http://127.0.0.1:18091/fhir'});
const suffix=randomUUID(), id='hf-conformance-'+suffix;
const patient={resourceType:'Patient',id,identifier:[{system:'https://med.gmac.io/synthetic',value:'HF-SYNTH-'+suffix}],name:[{family:'Synthetic',given:['Conformance']}],gender:'female',birthDate:'1990-01-01'};
const request={resourceType:'ServiceRequest',id,status:'active',intent:'order',subject:{reference:'Patient/'+id},code:{coding:[{system:'http://loinc.org',code:'718-7'}]}};
// This owner is deliberately separate from the Electronic Orders polling owner.
const task={resourceType:'Task',id,status:'requested',intent:'order',owner:{reference:'Practitioner/'+id},for:{reference:'Patient/'+id},basedOn:[{reference:'ServiceRequest/'+id}]};
const transaction=resources=>({resourceType:'Bundle',type:'transaction',entry:resources.map(resource=>({resource,request:{method:'PUT',url:resource.resourceType+'/'+resource.id,ifNoneMatch:'*'}}))});
const version=resource=>resource.meta?.versionId;
const evidence={checkedAt:new Date().toISOString(),host:'hetzner-master',server:'OpenELIS HAPI 6.6.0',fixture:id,scope:'create-only transaction replay and atomic rollback; not laboratory acceptance',passed:false};
try {
 await client.request('Patient/'+id,'Patient',{method:'PUT',body:patient});
 await client.request('Practitioner/'+id,'Practitioner',{method:'PUT',body:{resourceType:'Practitioner',id}});
 const bundle=transaction([request,task]);
 const created=await client.request('','Bundle',{method:'POST',body:bundle});
 if(created.type!=='transaction-response'||created.entry?.length!==2||created.entry.some(e=>!/^201(?: |$)/.test(e.response?.status??'')))throw Error('Initial create not confirmed');
 const accepted=await client.request('Task/'+id,'Task',{method:'PUT',body:{...task,status:'accepted'}});
 const originalRequest=await client.request('ServiceRequest/'+id,'ServiceRequest');
 async function expectConflict(body) {
  try {await client.request('','Bundle',{method:'POST',body});}
  catch(error){if(/HTTP (409|412)$/.test(error.message))return;throw error;}
  throw Error('Server allowed an existing resource to be overwritten');
 }
 await expectConflict(bundle);
 const after=await client.request('Task/'+id,'Task');
 const afterRequest=await client.request('ServiceRequest/'+id,'ServiceRequest');
 if(after.status!=='accepted'||version(after)!==version(accepted)||version(afterRequest)!==version(originalRequest))throw Error('Replay changed existing resources');
 const rollbackId=id+'-rollback';
 await expectConflict(transaction([{...request,id:rollbackId},task]));
 try {await client.request('ServiceRequest/'+rollbackId,'ServiceRequest');throw Error('Transaction partially committed');}
 catch(error){if(!/HTTP 404$/.test(error.message))throw error;}
 evidence.passed=true;
 evidence.checks=['two initial HTTP 201 receipts','accepted Task remains accepted at same version','ServiceRequest version unchanged on replay','new ServiceRequest rolled back atomically when existing Task conflicts'];
} catch(error){evidence.error=error.message;process.exitCode=1;}
writeFileSync(base+'/private/conformance-evidence.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(evidence,null,2));
