/** Run on hetzner-master. Never prints authorization or upstream clinical response bodies. */
import {readFileSync,writeFileSync} from 'node:fs';
const base='/mnt/master-apps/hospital-fabric';
const values=Object.fromEntries(readFileSync(base+'/private/deployment.env','utf8').trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)]}));
const {FhirClient}=await import(base+'/release/probe-client.mjs');
const results=[];
for(const [service,url,authorization] of [
 ['OpenMRS','http://127.0.0.1:18090/openmrs/ws/fhir2/R4','Basic '+Buffer.from('admin:'+values.OMRS_ADMIN_PASSWORD).toString('base64')],
 ['Order source HAPI','http://127.0.0.1:18093/fhir',undefined],
 ['OpenELIS HAPI','http://127.0.0.1:18091/fhir',undefined],
]) {
 try {
  if(service==='OpenMRS') {
   const session=await fetch('http://127.0.0.1:18090/openmrs/ws/rest/v1/session',{headers:{Authorization:authorization,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
   if(!session.ok||!(await session.json()).authenticated)throw Error('Private OpenMRS admin session is not authenticated');
  }
  const statement=await new FhirClient({baseUrl:url,authorization}).capabilities();
  results.push({service,ready:true,fhirVersion:statement.fhirVersion,software:statement.software,resourceCount:statement.rest?.reduce((n,rest)=>n+(rest.resource?.length??0),0)??0});
 } catch(error) {results.push({service,ready:false,error:error.message});}
}
const evidence={checkedAt:new Date().toISOString(),host:'hetzner-master',scope:'private synthetic product readiness; not order/result conformance',services:results};
writeFileSync(base+'/private/readiness-evidence.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(evidence,null,2));
if(results.some(result=>!result.ready))process.exitCode=1;
