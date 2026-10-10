/** Protocol tests only: the transport is fake; these are not OpenMRS/OpenELIS E2E tests. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
const bundle = await build({stdin:{contents:`export * from './apps/worker/src/adapters/real/fhir-client'; export * from './apps/worker/src/adapters/real/openmrs'; export * from './apps/worker/src/adapters/real/openelis-task';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'neutral',write:false});
const {FhirClient,readSyntheticOpenMrsPatient,buildOpenElisTaskTransaction,inspectOpenElisTask,stageOpenElisTask} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const input={taskId:'task-1',requestId:'request-1',patientId:'patient-1',ownerId:'lab-1',patientIdentifierSystem:'http://openelis-global.org/pat_nationalId',patientIdentifier:'HF-SYNTH-patient-1',orderNumber:'HF-SYNTH-order-1',loincCode:'53225-9',authoredOn:'2026-10-10T22:00:00Z'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/fhir+json'}});
const client=(fn)=>new FhirClient({baseUrl:'http://127.0.0.1:8090/fhir',authorization:'Basic test-only',fetch:fn});
const resources=()=>buildOpenElisTaskTransaction(input).entry.map(x=>structuredClone(x.resource));
const patient={resourceType:'Patient',id:input.patientId,name:[{family:'Synthetic',given:['Fixture']}],gender:'female',birthDate:'1990-01-01',identifier:[{system:'http://openelis-global.org/pat_nationalId',value:'HF-SYNTH-patient-1'}]};

test('transport rejects insecure remote URLs, URL credentials and path escapes',async()=>{
 for(const baseUrl of ['http://example.com/fhir','https://user:secret@example.com/fhir','https://example.com/fhir?secret=a']) assert.throws(()=>new FhirClient({baseUrl}));
 const c=client(()=>assert.fail('must not fetch'));
 for(const path of ['https://evil.test/Patient','../Patient','Patient/%2e%2e','//evil.test']) await assert.rejects(c.request(path,'Patient'));
});
test('transport contains credentials, refuses redirects, and validates R4 metadata',async()=>{
 let options;
 const c=client(async(url,init)=>{assert.equal(String(url),'http://127.0.0.1:8090/fhir/metadata');options=init;return json({resourceType:'CapabilityStatement',fhirVersion:'4.0.1'});});
 await c.capabilities(); assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Basic test-only');assert.ok(options.signal);
 await assert.rejects(client(async()=>json({resourceType:'CapabilityStatement',fhirVersion:'5.0.0'})).capabilities());
});
test('login HTML, non-FHIR JSON, HTTP errors and oversized responses fail closed',async()=>{
 for(const response of [new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),json({user:'login'}),json({secret:'must not surface'},401),json({resourceType:'Patient',data:'x'.repeat(1_048_576)})]) {
  await assert.rejects(client(async()=>response).request('Patient/patient-1','Patient'),error=>!error.message.includes('must not surface'));
 }
});
test('OpenMRS returns exactly one synthetic identifier match',async()=>{
 const c=client(async(url)=>{assert.equal(url.searchParams.get('identifier'),'urn:hf|HF-SYNTH-1');return json({resourceType:'Bundle',total:1,entry:[{resource:{resourceType:'Patient',id:'p',identifier:[{system:'urn:hf',value:'HF-SYNTH-1'}]}}]});});
 assert.equal((await readSyntheticOpenMrsPatient(c,'urn:hf','HF-SYNTH-1')).id,'p');
 await assert.rejects(readSyntheticOpenMrsPatient(c,'urn:hf','real-patient'));
});
test('OpenMRS rejects fuzzy, duplicate and paginated identity matches',async()=>{
 for(const body of [{total:2,entry:[{resource:patient},{resource:patient}]},{total:1,entry:[{resource:patient}]},{entry:[{resource:patient}],link:[{relation:'next'}]}]) {
  await assert.rejects(readSyntheticOpenMrsPatient(client(async()=>json({resourceType:'Bundle',...body})),'urn:hf','HF-SYNTH-1'));
 }
 assert.equal(await readSyntheticOpenMrsPatient(client(async()=>json({resourceType:'Bundle',total:0})),'urn:hf','HF-SYNTH-1'),null);
});
test('transaction uses stable IDs and create-only preconditions, never reset-upserts',()=>{
 const tx=buildOpenElisTaskTransaction(input);assert.equal(tx.type,'transaction');assert.equal(tx.entry.length,2);
 assert.ok(tx.entry.every(x=>x.request.ifNoneMatch==='*'));assert.equal(tx.entry[1].resource.status,'requested');
 assert.equal(tx.entry[1].resource.owner.reference,'Practitioner/lab-1');assert.equal(tx.entry[0].resource.identifier[0].value,input.orderNumber);
 assert.throws(()=>buildOpenElisTaskTransaction({...input,orderNumber:'clinical-order'}));
});
test('store creation is awaiting laboratory, never accepted',async()=>{
 let writes=0;
 const c=client(async(url,init)=>{if(init.method==='GET')return json(patient);writes++;return json({resourceType:'Bundle',type:'transaction-response',entry:[{response:{status:'201 Created'}},{response:{status:'201 Created'}}]});});
 await assert.rejects(stageOpenElisTask(c,input,{createOnlyTransactionsVerified:false}));assert.equal(writes,0);
 assert.equal((await stageOpenElisTask(c,input,{createOnlyTransactionsVerified:true})).state,'awaiting_lab');assert.equal(writes,1);
});
test('staging rejects unsupported patient and non-create outcomes',async()=>{
 let writes=0;
 await assert.rejects(stageOpenElisTask(client(async(url,init)=>{if(init.method==='POST')writes++;return json({...patient,gender:'unknown'});}),input,{createOnlyTransactionsVerified:true}));assert.equal(writes,0);
 await assert.rejects(stageOpenElisTask(client(async(url,init)=>init.method==='GET'?json(patient):json({resourceType:'Bundle',type:'transaction-response',entry:[{response:{status:'200 OK'}},{response:{status:'201 Created'}}]})),input,{createOnlyTransactionsVerified:true}));
});
test('Task lifecycle separates requested, accepted, rejected and result availability',async()=>{
 for(const [status,state] of [['requested','awaiting_lab'],['accepted','accepted'],['in-progress','accepted'],['rejected','rejected'],['completed','needs_review'],['cancelled','needs_review']]) {
  const [request,task]=resources();task.status=status;
  assert.equal((await inspectOpenElisTask(client(async url=>json(url.pathname.includes('/Task/')?task:request)),input)).state,state);
 }
 const [request,task]=resources();task.status='completed';task.output=[{valueReference:{reference:'DiagnosticReport/report-1'}}];
 assert.deepEqual(await inspectOpenElisTask(client(async url=>json(url.pathname.includes('/Task/')?task:request)),input),{state:'completed',reportReferences:['DiagnosticReport/report-1']});
});
test('Task inspection rejects mismatched identities and external result URLs',async()=>{
 for(const mutate of [t=>t.for.reference='Patient/other',t=>t.owner.reference='Practitioner/other',t=>t.basedOn.push({reference:'ServiceRequest/other'}),t=>t.output=[{valueReference:{reference:'https://evil.test/report'}}]]){
  const [request,task]=resources();mutate(task);
  await assert.rejects(inspectOpenElisTask(client(async url=>json(url.pathname.includes('/Task/')?task:request)),input));
 }
});
test('ambiguous write errors omit remote secrets and are never retried automatically',async()=>{
 let writes=0;
 await assert.rejects(stageOpenElisTask(client(async(url,init)=>{if(init.method==='GET')return json(patient);writes++;throw Error('sensitive remote body');}),input,{createOnlyTransactionsVerified:true}),e=>e.message.includes('reconcile')&&!e.message.includes('sensitive'));
 assert.equal(writes,1);
});

test('staging requires exact expected synthetic patient identity and rejects mixed identifiers',async()=>{
 for(const identifiers of [[{system:input.patientIdentifierSystem,value:'HF-SYNTH-other'}],[...patient.identifier,{system:input.patientIdentifierSystem,value:'real-clinical-id'}]]){
  let writes=0;
  await assert.rejects(stageOpenElisTask(client(async(url,init)=>{if(init.method==='POST')writes++;return json({...patient,identifier:identifiers});}),input,{createOnlyTransactionsVerified:true}));
  assert.equal(writes,0);
 }
});

test('Task report dot-segment IDs and stream errors fail closed without remote details',async()=>{
 for(const ref of ['DiagnosticReport/.','DiagnosticReport/..']){
  const [request,task]=resources();task.status='completed';task.output=[{valueReference:{reference:ref}}];
  await assert.rejects(inspectOpenElisTask(client(async url=>json(url.pathname.includes('/Task/')?task:request)),input));
 }
 const response=new Response(new ReadableStream({start(controller){controller.error(Error('sensitive stream detail'));}}),{headers:{'content-type':'application/fhir+json'}});
 await assert.rejects(client(async()=>response).request('Patient/patient-1','Patient'),e=>e.name==='FhirProtocolError'&&!e.message.includes('sensitive stream detail'));
});
