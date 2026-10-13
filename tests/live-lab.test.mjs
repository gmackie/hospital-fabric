/** General live-product connector contract tests, with fake HTTP transports.
 * Actual private OpenMRS/OpenELIS deployment conformance is a separate host gate.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {TestDB} from './type3/db.mjs';
const output=await build({stdin:{contents:[
  "export * from './apps/worker/src/adapters/real/fhir-client';",
  "export * from './apps/worker/src/adapters/real/live-lab';",
  "export * from './apps/worker/src/adapters/real/live-chart';",
  "export * from './apps/worker/src/adapters/real/live-ledger';"
].join('\n'),resolveDir:process.cwd()},bundle:true,platform:'neutral',format:'esm',write:false});
const c=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const patientId='11111111-1111-4111-8111-111111111111',ownerId='22222222-2222-4222-8222-222222222222';
const secondPatientId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const conceptId='44444444-4444-4444-8444-444444444444',observationId='55555555-5555-4555-8555-555555555555';
const analysisId='66666666-6666-4666-8666-666666666666',reportId='77777777-7777-4777-8777-777777777777',specimenId='88888888-8888-4888-8888-888888888888';
const catalog={hb:{key:'hb',loinc:'718-7',specimen:'Whole Blood',enabled:true,openElisTestId:'12'},
  cr:{key:'cr',loinc:'2160-0',specimen:'Serum',enabled:true,openElisTestId:'13'}};
const input=(orderNumber='HF-SYNTH-O1',testKey='hb')=>({
  orderNumber,patientId,patientIdentifierSystem:'http://openelis-global.org/pat_nationalId',
  patientIdentifier:'HF-SYNTH-P1',ownerId,testKey,authoredOn:'2026-10-13T12:00:00Z'
});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/fhir+json'}});
const patient={resourceType:'Patient',id:patientId,name:[{family:'Synthetic'}],gender:'female',birthDate:'1990-01-01',
  identifier:[{system:input().patientIdentifierSystem,value:'HF-SYNTH-P1'}]};
const practitioner={resourceType:'Practitioner',id:ownerId};
function harness(){
  const sr=new Map(),tasks=new Map(),runs={posts:0,writeLost:false}, chartRows=[];
  const secondPatient={...patient,id:secondPatientId,identifier:[{system:input().patientIdentifierSystem,value:'HF-SYNTH-P2'}]};
  let conflict=false, completed=false, badReport=false;
  function find(map,query){
    const number=decodeURIComponent(query.get('identifier')??'').split('|')[1];
    const matches=[...map.values()].filter(v=>v.identifier?.some(id=>id.value===number));
    return response({resourceType:'Bundle',type:'searchset',total:matches.length,entry:matches.map(resource=>({resource}))});
  }
  async function fetcher(url,options){
    const target=new URL(url),path=target.pathname,method=options?.method||'GET';
    if(path.includes('/mrs/')&&path.endsWith('/Patient/'+patientId))return response(patient);
    if(path.includes('/mrs/')&&path.endsWith('/Patient/'+secondPatientId))return response(secondPatient);
    if(path.includes('/mrs/')&&path.endsWith('/Observation/'+observationId))return response({resourceType:'Observation',id:observationId,subject:{reference:'Patient/'+patientId}});
    if(path.endsWith('/Patient/'+patientId))return response(patient);
    if(path.endsWith('/Patient/'+secondPatientId))return response(secondPatient);
    if(path.endsWith('/Practitioner/'+ownerId))return response(practitioner);
    if(path.endsWith('/ServiceRequest')&&target.searchParams.has('identifier'))return find(sr,target.searchParams);
    if(path.endsWith('/Task')&&target.searchParams.has('identifier'))return find(tasks,target.searchParams);
    if(path.endsWith('/source/')&&method==='POST'){
      runs.posts++;
      const tx=JSON.parse(options.body),number=tx.entry[0].resource.identifier[0].value;
      if(!sr.has(number)){
        const srId='request-'+number,taskId='task-'+number;
        const request={...tx.entry[0].resource,id:srId};
        const task={...tx.entry[1].resource,id:taskId,basedOn:[{reference:'ServiceRequest/'+srId}]};
        sr.set(number,request);tasks.set(number,task);
      }
      if(runs.writeLost){runs.writeLost=false;throw Error('socket died after commit');}
      return response({resourceType:'Bundle',type:'transaction-response',entry:[
        {response:{status:'201 Created',location:'ServiceRequest/request-'+number}},
        {response:{status:'201 Created',location:'Task/task-'+number}}
      ]});
    }
    if(path.endsWith('/Task/task-HF-SYNTH-O1')){
      const task=tasks.get('HF-SYNTH-O1');return response({...task,status:completed?'completed':'accepted',
        output:completed?[{valueReference:{reference:'DiagnosticReport/'+reportId}}]:[]});
    }
    if(path.endsWith('/DiagnosticReport/'+reportId)){
      return response({resourceType:'DiagnosticReport',id:reportId,meta:{versionId:'1'},status:'final',
        subject:{reference:badReport?'Patient/other':'Patient/'+patientId},code:{coding:[{system:'http://loinc.org',code:'718-7'}]},
        basedOn:[{reference:'ServiceRequest/'+analysisId}],specimen:[{reference:'Specimen/'+specimenId}],
        result:[{reference:'Observation/'+observationId}]});
    }
    if(path.endsWith('/ServiceRequest/'+analysisId)){
      return response({resourceType:'ServiceRequest',id:analysisId,status:'completed',
        subject:{reference:'Patient/'+patientId},code:{coding:[{system:'http://loinc.org',code:'718-7'}]},
        basedOn:[{reference:'ServiceRequest/HF-SYNTH-O1'}],requisition:{value:'ACC-1'}});
    }
    if(path.endsWith('/Observation/'+observationId)){
      return response({resourceType:'Observation',id:observationId,status:'final',meta:{versionId:'1'},
        subject:{reference:'Patient/'+patientId},specimen:{reference:'Specimen/'+specimenId},
        basedOn:[{reference:'ServiceRequest/'+analysisId}],code:{coding:[{system:'http://loinc.org',code:'718-7'}]},
        valueQuantity:{value:13.2,system:'http://unitsofmeasure.org',code:'g/dL',unit:'g/dL'},
        effectiveDateTime:'2026-10-13T12:01:00Z'});
    }
    if(path.endsWith('/Specimen/'+specimenId))
      return response({resourceType:'Specimen',id:specimenId,subject:{reference:'Patient/'+patientId}});
    if(path.includes('/ws/rest/v1/')){
      if(path.endsWith('/concept'))return new Response(JSON.stringify({results:[{uuid:conceptId,units:'g/dL',datatype:{display:'Numeric'},mappings:[{display:'LOINC: 718-7'}]}]}),{headers:{'content-type':'application/json'}});
      if(path.endsWith('/obs')){
        if(method==='POST'){
          const body=JSON.parse(options.body),row={...body,uuid:observationId,person:{uuid:patientId},concept:{uuid:conceptId},voided:false};
          chartRows.push(row);return new Response(JSON.stringify(row),{headers:{'content-type':'application/json'}});
        }
        return new Response(JSON.stringify({results:chartRows}),{headers:{'content-type':'application/json'}});
      }
    }
    throw Error('Unmocked private request '+method+' '+target.pathname+target.search);
  }
  const source=new c.FhirClient({baseUrl:'http://127.0.0.1:18093/source',fetch:fetcher});
  const results=new c.FhirClient({baseUrl:'http://127.0.0.1:18091/result',fetch:fetcher});
  const openMrs=new c.FhirClient({baseUrl:'http://127.0.0.1:18090/mrs',fetch:fetcher});
  return {config:{source,results,openMrs,catalog,conditionalCreateVerified:true,allowSandboxWrites:true},
    fake:fetcher,runs,chartRows,sr,tasks,complete(){completed=true;},badReport(){badReport=true;}};
}
function ledger(){
  const db=new TestDB();
  db.raw.exec(readFileSync('deploy/real/live-lab-migrations/0001_live.sql','utf8'));
  return {db,journal:new c.PrivateLabLedger(db)};
}
test('the live adapter accepts arbitrary reviewed test codes and many independent orders',()=>{
  const cases=c.planOrders(catalog,input(),[{orderNumber:'HF-SYNTH-A',testKey:'hb'},{orderNumber:'HF-SYNTH-B',testKey:'cr'}]);
  assert.equal(cases.length,2);assert.equal(cases[1].testKey,'cr');
  assert.equal(c.buildLiveTaskBundle(cases[1],catalog.cr).entry[0].resource.code.coding[0].code,'2160-0');
  assert.throws(()=>c.planOrders(catalog,input(),[{orderNumber:'HF-SYNTH-A',testKey:'hb'},{orderNumber:'HF-SYNTH-A',testKey:'cr'}]));
  assert.throws(()=>c.planOrders(catalog,input(),[{orderNumber:'clinical-O1',testKey:'hb'}]));
  assert.throws(()=>c.testFor(catalog,'not-installed'));
});
test('real FHIR source conditionally stages and reconciles multiple orders without resubmitting',async()=>{
  const h=harness();
  const second={...input('HF-SYNTH-O3','hb'),patientId:secondPatientId,patientIdentifier:'HF-SYNTH-P2'};
  for(const o of [input(),input('HF-SYNTH-O2','cr'),second])assert.equal((await c.stageLiveOrder(h.config,o)).state,'awaiting_lab');
  assert.equal(h.runs.posts,3);
  assert.equal((await c.stageLiveOrder(h.config,input())).taskId,'task-HF-SYNTH-O1');
  assert.equal(h.runs.posts,3);
});
test('writer refuses unverified transaction capability, bad identity and bad catalog',async()=>{
  const h=harness();await assert.rejects(()=>c.stageLiveOrder({...h.config,conditionalCreateVerified:false},input()));assert.equal(h.runs.posts,0);
  await assert.rejects(()=>c.stageLiveOrder(h.config,{...input(),patientIdentifier:'REAL-PERSON'}));assert.equal(h.runs.posts,0);
});
test('D1-backed ledger never retries a committed order after its HTTP acknowledgment is lost',async()=>{
  const h=harness(),d=ledger();try{
    h.runs.writeLost=true;
    await assert.rejects(()=>c.dispatchPrivateOrder(h.config,d.journal,input()),/reconcil/);
    assert.equal((await d.journal.getOrder(input().orderNumber)).state,'outcome_unknown');
    const restored=await c.dispatchPrivateOrder(h.config,d.journal,input());
    assert.equal(restored.state,'awaiting_lab');assert.equal(h.runs.posts,1);
    assert.equal(d.db.raw.prepare('SELECT count(*) AS n FROM live_lab_orders').get().n,1);
    await assert.rejects(()=>c.dispatchPrivateOrder(h.config,d.journal,{...input(),testKey:'cr'}),/reused/);
  }finally{d.db.close();}
});
test('OpenELIS product completion gates multi-resource numeric results with exact patient/order/specimen',async()=>{
  const h=harness();await c.stageLiveOrder(h.config,input());h.complete();
  const reports=await c.readCompletedLiveResults(h.config,input());
  assert.equal(reports.length,1);assert.equal(reports[0].accessionNumber,'ACC-1');
  assert.equal(reports[0].observations[0].loinc,'718-7');assert.equal(reports[0].observations[0].value.value,13.2);
  h.badReport();await assert.rejects(()=>c.readCompletedLiveResults(h.config,input()),/validated matching/);
});
test('result retrieval refuses incomplete laboratory Task or arbitrary report references',async()=>{
  const h=harness();await c.stageLiveOrder(h.config,input());
  await assert.rejects(()=>c.readCompletedLiveResults(h.config,input()),/not completed/);
  await assert.rejects(()=>c.readReleasedReports(h.config.results,catalog,input(),['https://evil.test/r']));
});
test('chart writer dynamically resolves installed LOINC mapping, inserts once and verifies REST/FHIR',async()=>{
  const h=harness(),d=ledger();
  try{
    await c.stageLiveOrder(h.config,input());h.complete();
    const report=(await c.readCompletedLiveResults(h.config,input()))[0],obs=report.observations[0];
    const cfg={restBaseUrl:'http://127.0.0.1:18090/ws/rest/v1',authorization:'Basic test',
      fetch:h.fake,allowSyntheticChartWrites:true,
      conceptMap:{'718-7':{uuid:conceptId,units:'g/dL',datatype:'Numeric'}}};
    assert.ok(report.orderNumber.startsWith('HF-SYNTH-'), 'order number');
    assert.ok(report.accessionNumber, 'accession');
    assert.equal(report.status,'final');
    assert.ok(obs.effectiveDateTime, 'effective time');
    assert.equal(obs.value.kind,'quantity');
    assert.equal(obs.value.system,'http://unitsofmeasure.org');
    assert.equal(cfg.allowSyntheticChartWrites,true);
    assert.equal(report.id.length,36);
    assert.equal(obs.resourceId.length,36);
    assert.equal((await c.importNumericChartResult(cfg,h.config.openMrs,d.journal,report,obs)).state,'imported');
    assert.equal((await c.importNumericChartResult(cfg,h.config.openMrs,d.journal,report,obs)).state,'existing');
    assert.equal(h.chartRows.length,1);
    assert.equal(d.db.raw.prepare('SELECT state FROM live_chart_writes').get().state,'completed');
  }finally{d.db.close();}
});
