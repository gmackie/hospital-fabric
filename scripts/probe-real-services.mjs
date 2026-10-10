/** Read-only server-side probe. Uses existing operator-supplied credentials; never logs them. */
import {build} from 'esbuild';
const result=await build({stdin:{contents:"export * from './apps/worker/src/adapters/real/fhir-client'; export * from './apps/worker/src/adapters/real/openmrs';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'neutral',write:false});
const {FhirClient,readSyntheticOpenMrsPatient}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
for(const [label,prefix] of [['OpenMRS','OPENMRS'],['OpenELIS co-resident HAPI store','OPENELIS_STORE']]){
 const baseUrl=process.env[`${prefix}_FHIR_URL`];
 if(!baseUrl)throw Error(`${prefix}_FHIR_URL is required`);
 const client=new FhirClient({baseUrl,authorization:process.env[`${prefix}_AUTHORIZATION`]});
 const metadata=await client.capabilities();
 console.log(`${label}: FHIR ${metadata.fhirVersion} capability statement verified`);
 if(prefix==='OPENMRS'&&process.env.HF_SYNTHETIC_IDENTIFIER){
  const patient=await readSyntheticOpenMrsPatient(client,process.env.HF_IDENTIFIER_SYSTEM??'',process.env.HF_SYNTHETIC_IDENTIFIER);
  console.log(`OpenMRS synthetic patient: ${patient?'exact identity verified':'not found'}`);
 }
}
console.log('Read probes only. No order was submitted; laboratory acceptance and result return are unverified.');
