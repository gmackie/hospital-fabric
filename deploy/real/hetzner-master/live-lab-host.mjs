/** Private host adapter: talks to REAL running OpenMRS and OpenELIS instances.
 * Usage: node --experimental-sqlite live-lab-host.mjs inspect|stage|chart <private-case.json>
 * Never exposes an HTTP listener, credentials, IDs or raw results to public demo.
 */
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync,mkdirSync,chmodSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const root=process.env.HF_BASE_DIR||'/mnt/master-apps/hospital-fabric';
const privateDir=resolve(root,'private');
const command=process.argv[2]||'inspect';
if(!['inspect','stage','chart'].includes(command))throw Error('Expected inspect, stage or chart');
const path=resolve(process.argv[3]||join(privateDir,'lab-order-source.json'));
if(relative(privateDir,path).startsWith('..')||!path.endsWith('.json'))throw Error('Case file must live in the private host directory');
const modulePath=resolve(root,'release/deploy/real/hetzner-master/dist/live-connectors.mjs');
if(!existsSync(modulePath))throw Error('Build live connectors and install the bundle in release before using the host agent');
const {FhirClient,PrivateLabLedger,dispatchPrivateOrder,reconcileLiveOrder,readCompletedLiveResults,
  importNumericChartResult,validateLiveCatalog}=await import(pathToFileURL(modulePath));
const cases=JSON.parse(readFileSync(path,'utf8'));
const list=Array.isArray(cases.orders)?cases.orders:[cases.input??cases];
if(!list.length||list.length>20)throw Error('Case file must contain 1..20 orders');
const env=Object.fromEntries(readFileSync(join(privateDir,'deployment.env'),'utf8').split('\n').filter(x=>x.includes('=')).map(x=>{
  const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1).trim()];
}));
if(!env.OMRS_ADMIN_PASSWORD)throw Error('Private OpenMRS service credential is missing');
const catalogFile=join(privateDir,'live-lab-catalog.json');
const evidenceFile=join(privateDir,'lab-catalog-evidence.json');
let catalog;
if(existsSync(catalogFile))catalog=JSON.parse(readFileSync(catalogFile,'utf8'));
else{
  const evidence=JSON.parse(readFileSync(evidenceFile,'utf8'));
  if(evidence.loinc!=='718-7'||!evidence.testId)throw Error('No installed, reviewed catalog available');
  catalog={installedHb:{key:'installedHb',loinc:evidence.loinc,specimen:evidence.sampleType||'Whole Blood',
    enabled:true,openElisTestId:String(evidence.testId)}};
}
validateLiveCatalog(catalog);
const testForLoinc=(loinc)=>Object.entries(catalog).filter(([,v])=>v.loinc===loinc&&v.enabled);
const requests=list.map(item=>{
  const found=item.testKey?[[item.testKey,catalog[item.testKey]]]:testForLoinc(item.loincCode);
  if(found.length!==1||!found[0][1])throw Error('Case laboratory test has no exact approved installed mapping');
  return {
    orderNumber:item.orderNumber,patientId:item.patientId,patientIdentifierSystem:item.patientIdentifierSystem,
    patientIdentifier:item.patientIdentifier,ownerId:item.ownerId,authoredOn:item.authoredOn,testKey:found[0][0]
  };
});
const auth='Basic '+Buffer.from('admin:'+env.OMRS_ADMIN_PASSWORD).toString('base64');
const conn={
  source:new FhirClient({baseUrl:'http://127.0.0.1:18093/fhir'}),
  results:new FhirClient({baseUrl:'http://127.0.0.1:18091/fhir'}),
  openMrs:new FhirClient({baseUrl:'http://127.0.0.1:18090/openmrs/ws/fhir2/R4',authorization:auth}),
  catalog,
  conditionalCreateVerified:false,
  allowSandboxWrites:false
};
const conformance=join(privateDir,'adapter-conformance-evidence.json');
if(existsSync(conformance)){
  const ev=JSON.parse(readFileSync(conformance,'utf8'));
  const age=Date.now()-Date.parse(ev.checkedAt);
  conn.conditionalCreateVerified=ev.passed===true&&age>=0&&age<7*86400000;
}
conn.allowSandboxWrites=process.env.HF_LIVE_SANDBOX_WRITES==='1'&&conn.conditionalCreateVerified;
if((command==='stage'||command==='chart')&&!conn.allowSandboxWrites)throw Error('Writes require explicit synthetic sandbox flag and recent live conditional-transaction conformance');
if(requests.some(r=>!r.orderNumber.startsWith('HF-SYNTH-')||!r.patientIdentifier.startsWith('HF-SYNTH-')))
  throw Error('Current isolated instance connector permits synthetic identities only');
const pathDB=join(privateDir,'live-lab.sqlite');
mkdirSync(privateDir,{recursive:true,mode:0o700});
const db=new DatabaseSync(pathDB);
chmodSync(pathDB,0o600);
db.exec('PRAGMA foreign_keys=ON');
db.exec(readFileSync(resolve(root,'release/deploy/real/live-lab-migrations/0001_live.sql'),'utf8'));
const journal=new PrivateLabLedger({prepare(sql){let v=[];return{
  bind(...xs){v=xs;return this;},
  async first(){return db.prepare(sql).get(...v)??null;},
  async run(){const r=db.prepare(sql).run(...v);return {meta:{changes:Number(r.changes)}};}
};}});
const summaries=[];
try{
  for(const item of requests){
    let order;
    if(command==='stage')order=await dispatchPrivateOrder(conn,journal,item);
    else order=await reconcileLiveOrder(conn.source,conn.catalog,item);
    if(!order){summaries.push({state:'not_found',test:item.testKey});continue;}
    const summary={test:item.testKey,sourceState:order.state,orderReconciled:true};
    if(order.state==='rejected'){summaries.push(summary);continue;}
    // The laboratory's output is authoritative only after its product Task completes.
    try {
      const reports=await readCompletedLiveResults(conn,item);
      summary.state='completed_in_product';
      summary.reports=reports.length;
      summary.observations=reports.reduce((n,r)=>n+r.observations.length,0);
      summary.statuses=reports.map(r=>r.status);
      for(const report of reports) {
        const digest=createHash('sha256').update(JSON.stringify(report)).digest('hex');
        await journal.claimOrder(item);
        await journal.recordResult(item.orderNumber,report.id,report.version,report.status,digest);
      }
      if(command==='chart') {
        const mapFile=join(privateDir,'live-lab-openmrs-concepts.json');
        if(!existsSync(mapFile))throw Error('Review and provide the private live-lab-openmrs-concepts.json mapping');
        const conceptMap=JSON.parse(readFileSync(mapFile,'utf8'));
        const configuration={restBaseUrl:'http://127.0.0.1:18090/openmrs/ws/rest/v1',
          authorization:auth,allowSyntheticChartWrites:process.env.HF_LIVE_CHART_IMPORT==='1',conceptMap};
        if(!configuration.allowSyntheticChartWrites)throw Error('Chart import needs separate HF_LIVE_CHART_IMPORT=1 approval');
        const imported=[];
        for(const report of reports)for(const obs of report.observations)
          imported.push((await importNumericChartResult(configuration,conn.openMrs,journal,report,obs)).state);
        summary.chartActions=imported;
      }
    } catch(error) {
      summary.state='needs_review';
      summary.reason=String(error?.message??'Unknown remote failure').slice(0,160);
      if(command==='chart')throw error;
    }
    summaries.push(summary);
  }
  // Safe evidence: no IDs, names, values, auth headers or raw FHIR payloads.
  const evidence={mode:'real-OpenMRS-OpenELIS-products',scope:'isolated-synthetic',actions:command,
    verifiedAt:new Date().toISOString(),installedTestCount:Object.keys(catalog).length,
    cases:summaries,clinicalUseAllowed:false,warning:'Not clinical validation'};
  console.log(JSON.stringify(evidence,null,2));
}finally{db.close();}
