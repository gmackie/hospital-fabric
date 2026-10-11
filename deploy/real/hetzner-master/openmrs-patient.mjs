/** Register/reconcile only a generated synthetic identity using supported OpenMRS REST. */
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const base='/mnt/master-apps/hospital-fabric';
const {FhirClient,readSyntheticOpenMrsPatient}=await import(base+'/release/probe-client.mjs');
const values=Object.fromEntries(readFileSync(base+'/private/deployment.env','utf8').trim().split('\n').map(line=>{const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)]}));
let authorization='Basic '+Buffer.from('admin:'+values.OMRS_ADMIN_PASSWORD).toString('base64');

async function rest(path,body) {
 const response=await fetch('http://127.0.0.1:18090/openmrs/ws/rest/v1/'+path,{method:body?'POST':'GET',headers:{Authorization:authorization,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('OpenMRS REST returned HTTP '+response.status);
 return response.json();
}
const file=base+'/private/openmrs-patient.json';
let record=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{identifier:'HF-SYNTH-'+randomUUID(),phase:'prepared'};
const persist=()=>writeFileSync(file,JSON.stringify(record,null,2)+'\n',{mode:0o600});persist();
let session;
try {session=await rest('session');} catch(error) {if(!error.message.includes('HTTP 401'))throw error;}
if(!session?.authenticated) {
 authorization='Basic '+Buffer.from('admin:test').toString('base64');
 session=await rest('session');
 if(!session.authenticated||!session.user?.uuid)throw Error('Neither configured nor verified packaged legacy admin password authenticated');
 await rest('user/'+session.user.uuid,{password:values.OMRS_ADMIN_PASSWORD});
 authorization='Basic '+Buffer.from('admin:'+values.OMRS_ADMIN_PASSWORD).toString('base64');
 session=await rest('session');if(!session.authenticated)throw Error('Private OpenMRS admin login not verified after rotation');
}
const types=(await rest('patientidentifiertype?v=default')).results;
let type=types.find(type=>type.name==='Hospital Fabric Synthetic');
if(!type)type=await rest('patientidentifiertype',{name:'Hospital Fabric Synthetic',description:'Generated HF-SYNTH identifiers for the isolated Hospital Fabric demo; no clinical identities.',required:false});
record.identifierType=type.uuid;persist();
let candidates=(await rest('patient?q='+encodeURIComponent(record.identifier)+'&v=full')).results;
let matches=candidates.filter(patient=>patient.identifiers?.some(id=>id.identifier===record.identifier&&id.identifierType.uuid===type.uuid));
if(matches.length>1)throw Error('Ambiguous synthetic registration');
let patient=matches[0];
if(!patient){
 if(record.phase!=='prepared')throw Error('Prior registration outcome unknown; reconcile before another write');
 const locations=(await rest('location?v=default')).results;
 const location=locations.find(l=>!l.retired);if(!location)throw Error('No active registration location');
 const requiredTypes=types.filter(item=>item.required&&item.uuid!==type.uuid);
 const requiredIdentifiers=[];
 for(const required of requiredTypes) {
  if(!record.requiredIdentifiers?.[required.uuid]) {
   const sources=(await rest('idgen/identifiersource?v=full')).results.filter(item=>item.identifierType?.uuid===required.uuid);
   if(sources.length!==1)throw Error('Required identifier needs exactly one supported generator');
   const generated=await rest('idgen/identifiersource/'+sources[0].uuid+'/identifier',{comment:record.identifier});
   if(!generated.identifier)throw Error('Identifier generator returned no identifier');
   record.requiredIdentifiers={...record.requiredIdentifiers,[required.uuid]:generated.identifier};persist();
  }
  requiredIdentifiers.push({identifier:record.requiredIdentifiers[required.uuid],identifierType:required.uuid,location:location.uuid,preferred:false});
 }
 record.phase='registration_started';persist();
 patient=await rest('patient',{person:{names:[{givenName:'Hospital Fabric',familyName:'Synthetic'}],gender:'F',birthdate:'1990-01-01'},identifiers:[{identifier:record.identifier,identifierType:type.uuid,location:location.uuid,preferred:true},...requiredIdentifiers]});
}
record.patientId=patient.uuid;record.phase='registered';persist();
const client=new FhirClient({baseUrl:'http://127.0.0.1:18090/openmrs/ws/fhir2/R4',authorization});
const fhir=await client.request('Patient/'+patient.uuid,'Patient');
const identifier=fhir.identifier?.find(item=>item.value===record.identifier);
if(!identifier?.system)throw Error('FHIR identity missing registered identifier system');
const exact=await readSyntheticOpenMrsPatient(client,identifier.system,record.identifier,{searchSystem:type.name});
if(exact?.id!==patient.uuid)throw Error('Exact FHIR identity did not match registration');
record.identifierSystem=identifier.system;record.verifiedAt=new Date().toISOString();persist();
console.log(JSON.stringify({registered:true,patientId:record.patientId,identifier:record.identifier,identifierSystem:record.identifierSystem,exactFhirMatch:true,scope:'private generated synthetic identity'},null,2));
