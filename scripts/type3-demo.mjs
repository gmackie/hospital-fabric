import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const url=new URL(process.env.TYPE3_URL??'http://127.0.0.1:8788');
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Demo is limited to loopback');
const key=process.env.TYPE3_API_KEY;if(!key||key.length<32)throw new Error('Set TYPE3_API_KEY from the local .dev.vars (never commit it)');
async function api(path,body){const r=await fetch(new URL(path,url),{method:body?'POST':'GET',headers:{'x-type3-token':key,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});const data=await r.json();if(!r.ok)throw new Error(`${r.status} ${JSON.stringify(data)}`);return data;}
const protocol=await api('/v2/protocol');assert.equal(protocol.protocol,'hospital-fabric-type3-commands/v2');
await api('/v2/admin/bootstrap',{});const id=`exercise-${randomUUID().slice(0,8)}`;
let snapshot=await api('/v2/studies',{id,profile:'emt3-research-v2'});const base=`/v2/studies/${id}`;
async function action(name,args,actor='operator'){snapshot=await api(base+'/commands',{requestId:randomUUID(),expectedVersion:snapshot.state.version,actor,action:name,args});}
await action('patient.arrive',{patientId:'SIM-P1'});await action('icu.admit',{patientId:'SIM-P1'});
await action('dependency.set',{key:'oxygenSlots',value:0,validForMinutes:480});const degraded=await api(base+'/readiness');assert.equal(degraded.overcommitted,1);assert.equal(snapshot.state.icu.length,1);
await action('dependency.set',{key:'oxygenSlots',value:4,validForMinutes:480});
await action('lab.order',{orderId:'SIM-LAB1',patientId:'SIM-P1',specimenId:'SIM-SP1',test:'blood-gas',referringFacility:'SIM-EMT2'});
await action('lab.receive',{orderId:'SIM-LAB1'},'lab');await action('lab.process',{orderId:'SIM-LAB1'},'lab');await action('lab.release',{orderId:'SIM-LAB1',status:'final',critical:true},'lab');await action('lab.acknowledge',{orderId:'SIM-LAB1',revision:1});
await action('patient.arrive',{patientId:'SIM-P2'});await action('ward.admit',{patientId:'SIM-P2'});await action('surgery.book',{caseId:'SIM-C1',patientId:'SIM-P2'},'theatre');await action('surgery.start',{caseId:'SIM-C1'},'theatre');await action('surgery.finish',{caseId:'SIM-C1'},'theatre');await action('surgery.recover',{caseId:'SIM-C1'},'theatre');
await action('sterile.clean',{setId:'SIM-SET-001'},'theatre');await action('sterile.cycle',{setId:'SIM-SET-001',cycleId:'SIM-CYCLE1',passed:true},'theatre');await action('sterile.release',{setId:'SIM-SET-001',cycleId:'SIM-CYCLE1'},'reviewer');
await action('link.set',{link:'wan',available:false});await action('referral.request',{referralId:'SIM-R1',patientId:'SIM-RP1',origin:'SIM-EMT1',care:'ward'},'coordinator');await action('referral.send',{referralId:'SIM-R1',route:'radio'},'coordinator');await action('referral.acknowledge',{referralId:'SIM-R1'},'coordinator');await action('referral.accept',{referralId:'SIM-R1'},'coordinator');await action('referral.depart',{referralId:'SIM-R1'},'coordinator');await action('referral.arrive',{referralId:'SIM-R1'},'coordinator');await action('referral.handover',{referralId:'SIM-R1',handoverId:'SIM-HAND1'});
await action('device.observe',{observation:{deviceId:'SIM-DEVICE-GATEWAY-001',sequence:1,observedMinute:0,mode:'synthetic',metric:'heartbeat',value:1}},'biomed');
const proof=await api(base+'/export');await action('evidence.record',{id:'SIM-EVIDENCE1',gate:'referral-handover',artifactDigest:proof.stateDigest,result:'pass',configurationVersion:snapshot.state.configurationVersion,validForMinutes:480,scope:'synthetic'},'reviewer');
const exported=await api(base+'/export');assert.equal(exported.clinicalUseAllowed,false);writeFileSync(process.argv[2]??'type3-evidence.json',JSON.stringify(exported,null,2));
console.log(JSON.stringify({study:id,commands:exported.state.version,digest:exported.stateDigest,phasesExercised:['P0','P1','P2','P3','P4','P5','P6'],physicalHardwareTested:false,clinicalValidation:false,wanDisconnection:'model-only'},null,2));
