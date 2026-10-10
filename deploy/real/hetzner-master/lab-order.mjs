/** Stage exactly one durable synthetic laboratory fixture; reruns reconcile only. */
import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
const base='/mnt/master-apps/hospital-fabric';
const {FhirClient,stageOpenElisTask,reconcileOpenElisTask}=await import(base+'/release/probe-client.mjs');
const client=new FhirClient({baseUrl:'http://127.0.0.1:18091/fhir'});
const values=Object.fromEntries(readFileSync(base+'/private/deployment.env','utf8').trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)]}));
const file=base+'/private/lab-order.json';
const catalog=JSON.parse(readFileSync(base+'/private/lab-catalog-evidence.json','utf8'));
const verified=JSON.parse(readFileSync(base+'/private/adapter-conformance-evidence.json','utf8'));
if(!verified.passed||catalog.loinc!=='718-7')throw Error('Verified catalog and live conditional adapter conformance required');
let record;
if(existsSync(file))record=JSON.parse(readFileSync(file,'utf8'));
else {
 const uuid=randomUUID();
 const input={taskId:'task-'+uuid,requestId:'request-'+uuid,patientId:uuid,ownerId:values.OE_SYNTHETIC_OWNER_ID,patientIdentifierSystem:'http://openelis-global.org/pat_nationalId',patientIdentifier:'HF-SYNTH-'+uuid,orderNumber:'HF-SYNTH-'+uuid,loincCode:'718-7',authoredOn:new Date().toISOString()};
 record={input,phase:'prepared'};writeFileSync(file,JSON.stringify(record,null,2)+'\n',{mode:0o600});
}
const persist=()=>writeFileSync(file,JSON.stringify(record,null,2)+'\n',{mode:0o600});
if(record.phase==='prepared') {
 const input=record.input;
 await client.request('Patient/'+input.patientId,'Patient',{method:'PUT',body:{resourceType:'Patient',id:input.patientId,identifier:[{system:input.patientIdentifierSystem,value:input.patientIdentifier}],name:[{family:'Synthetic',given:['Laboratory']}],gender:'female',birthDate:'1990-01-01'}});
 await client.request('Practitioner/'+input.ownerId,'Practitioner',{method:'PUT',body:{resourceType:'Practitioner',id:input.ownerId,active:true,name:[{text:'Hospital Fabric Synthetic Laboratory'}]}});
 record.phase='submission_started';persist();
 const receipt=await stageOpenElisTask(client,input,{conditionalCreateTransactionsVerified:true});
 record.receipt=receipt;record.phase='submitted';persist();
}
record.inspected=await reconcileOpenElisTask(client,record.input);record.checkedAt=new Date().toISOString();persist();
console.log(JSON.stringify({orderNumber:record.input.orderNumber,phase:record.phase,...record.inspected,scope:'actual laboratory lifecycle; submitted is not laboratory accepted'},null,2));
