/** Live conditional-create proof; owner excluded from the OpenELIS polling queue. */
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const base='/mnt/master-apps/hospital-fabric';
const {FhirClient}=await import(base+'/release/probe-client.mjs');
const client=new FhirClient({baseUrl:'http://127.0.0.1:18091/fhir'});
const key=randomUUID(), local='hf-conditional-'+key, order='HF-SYNTH-'+key;
const system='https://hospital-fabric.example/synthetic-order';
const fullUrl='urn:uuid:'+randomUUID();
const request={resourceType:'ServiceRequest',identifier:[{system,value:order}],status:'active',intent:'order',subject:{reference:'Patient/'+local},code:{coding:[{system:'http://loinc.org',code:'718-7'}]}};
const task={resourceType:'Task',identifier:[{system,value:order}],status:'requested',intent:'order',owner:{reference:'Practitioner/'+local},for:{reference:'Patient/'+local},basedOn:[{reference:fullUrl}]};
const bundle={resourceType:'Bundle',type:'transaction',entry:[{fullUrl,resource:request,request:{method:'POST',url:'ServiceRequest',ifNoneExist:'identifier='+encodeURIComponent(system+'|'+order)}},{fullUrl:'urn:uuid:'+randomUUID(),resource:task,request:{method:'POST',url:'Task',ifNoneExist:'identifier='+encodeURIComponent(system+'|'+order)}}]};
const getId=(entry,type)=>{const match=entry.response?.location?.match(new RegExp('(?:^|/)'+type+'/([A-Za-z0-9.-]+)(?:/_history/[A-Za-z0-9.-]+)?$'));if(!match)throw Error('Missing receipt location');return match[1];};
const evidence={checkedAt:new Date().toISOString(),host:'hetzner-master',fixture:local,scope:'conditional POST replay/concurrent creation; not lab acceptance',passed:false};
try {
 await client.request('Patient/'+local,'Patient',{method:'PUT',body:{resourceType:'Patient',id:local,identifier:[{system:'http://openelis-global.org/pat_nationalId',value:order}],name:[{family:'Synthetic',given:['Conformance']}],gender:'female',birthDate:'1990-01-01'}});
 await client.request('Practitioner/'+local,'Practitioner',{method:'PUT',body:{resourceType:'Practitioner',id:local}});
 const first=await client.request('','Bundle',{method:'POST',body:bundle});
 if(first.entry?.length!==2||first.entry.some(e=>!/^201(?: |$)/.test(e.response?.status??'')))throw Error('Initial creation not confirmed');
 const requestId=getId(first.entry[0],'ServiceRequest'),taskId=getId(first.entry[1],'Task');
 const original=await client.request('Task/'+taskId,'Task');
 if(original.basedOn?.[0]?.reference!=='ServiceRequest/'+requestId)throw Error('Transaction did not resolve internal references');
 const accepted=await client.request('Task/'+taskId,'Task',{method:'PUT',body:{...original,status:'accepted'}});
 const replay=await client.request('','Bundle',{method:'POST',body:bundle});
 if(replay.entry.some(e=>!/^200(?: |$)/.test(e.response?.status??''))||getId(replay.entry[0],'ServiceRequest')!==requestId||getId(replay.entry[1],'Task')!==taskId)throw Error('Replay changed correlated IDs');
 const after=await client.request('Task/'+taskId,'Task');
 if(after.status!=='accepted'||after.meta?.versionId!==accepted.meta?.versionId)throw Error('Replay reset or changed accepted Task');
 const concurrent=await Promise.all(Array.from({length:4},()=>client.request('','Bundle',{method:'POST',body:bundle})));
 if(concurrent.some(b=>getId(b.entry[1],'Task')!==taskId))throw Error('Concurrent replay created a duplicate');
 for(const type of ['Task','ServiceRequest']){
  const found=await client.request(type+'?identifier='+encodeURIComponent(system+'|'+order),'Bundle');
  if(found.total!==1)throw Error('Duplicate '+type+' found');
 }
 evidence.passed=true;evidence.taskId=taskId;evidence.requestId=requestId;
 evidence.checks=['initial creation','fullUrl references resolved','accepted status and version preserved on replay','four concurrent replays returned same IDs','exactly one Task and one ServiceRequest'];
} catch(error){evidence.error=error.message;process.exitCode=1;}
writeFileSync(base+'/private/conditional-conformance-evidence.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(evidence,null,2));
