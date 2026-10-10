/** Exercise the actual adapter against live HAPI with a non-polling synthetic owner. */
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const base='/mnt/master-apps/hospital-fabric';
const {FhirClient,stageOpenElisTask,reconcileOpenElisTask}=await import(base+'/release/probe-client.mjs');
const client=new FhirClient({baseUrl:'http://127.0.0.1:18091/fhir'});
const uuid=randomUUID(),id=uuid,ownerId=randomUUID();
const input={taskId:'task-'+uuid,requestId:'request-'+uuid,patientId:id,ownerId,patientIdentifierSystem:'http://openelis-global.org/pat_nationalId',patientIdentifier:'HF-SYNTH-'+uuid,orderNumber:'HF-SYNTH-'+uuid,loincCode:'718-7',authoredOn:new Date().toISOString()};
const evidence={checkedAt:new Date().toISOString(),host:'hetzner-master',scope:'actual adapter staging and lost-receipt reconciliation; not lab acceptance',passed:false};
try {
 await client.request('Patient/'+id,'Patient',{method:'PUT',body:{resourceType:'Patient',id,identifier:[{system:input.patientIdentifierSystem,value:input.patientIdentifier}],name:[{family:'Synthetic',given:['Adapter']}],gender:'female',birthDate:'1990-01-01'}});
 await client.request('Practitioner/'+ownerId,'Practitioner',{method:'PUT',body:{resourceType:'Practitioner',id:ownerId}});
 const created=await stageOpenElisTask(client,input,{conditionalCreateTransactionsVerified:true});
 const task=await client.request('Task/'+created.taskId,'Task');
 const accepted=await client.request('Task/'+created.taskId,'Task',{method:'PUT',body:{...task,status:'accepted'}});
 try {await stageOpenElisTask(client,input,{conditionalCreateTransactionsVerified:true});throw Error('Replay incorrectly claimed creation');}
 catch(error){if(!error.message.includes('inspect remote Task'))throw error;}
 const recovered=await reconcileOpenElisTask(client,input);
 const after=await client.request('Task/'+created.taskId,'Task');
 if(recovered.state!=='accepted'||recovered.taskId!==created.taskId||recovered.requestId!==created.requestId||accepted.meta?.versionId!==after.meta?.versionId)throw Error('Adapter reconciliation mismatch');
 evidence.passed=true;evidence.taskId=created.taskId;evidence.requestId=created.requestId;
 evidence.checks=['actual builder staged once','conditional replay rejected fresh-creation claim','reconciled exact original IDs and accepted status','Task version unchanged'];
} catch(error){evidence.error=error.message;process.exitCode=1;}
writeFileSync(base+'/private/adapter-conformance-evidence.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(evidence,null,2));
