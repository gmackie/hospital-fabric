import { MODEL_VERSION, PROTOCOL, canonical, fields, integer, identifier, syntheticId, choice, requireThat, ResearchError } from './protocol.js';
import { profile, type Profile } from './profiles.js';
import { type Device, parseTelemetry } from './hardware.js';
import { TESTS, intake, fromFhirBundle, syntheticReport, type LabOrder, type LabReport } from './laboratory.js';
export const DEPENDENCIES=['icuNurses','intensivists','wardNurses','powerSlots','oxygenSlots','suctionSlots','labAvailable','bloodAvailable','theatreTeams','pacuNurses','waterAvailable','sterilizerAvailable','imagingAvailable','theatrePowerAvailable','theatreOxygenAvailable'] as const;
export type DependencyKey=typeof DEPENDENCIES[number];
export type Role='operator'|'lab'|'theatre'|'coordinator'|'biomed'|'reviewer';
export const ROLES=['operator','lab','theatre','coordinator','biomed','reviewer'] as const;
export type Patient={id:string;location:'waiting'|'external'|'ward'|'icu'|'theatre'|'pacu'|'discharged';wardBed:string|null};
export type IcuAssignment={patientId:string;bedId:string;ventilatorId:string;monitorId:string};
export type SurgicalCase={id:string;patientId:string;status:'booked'|'operating'|'recovery'|'completed'|'cancelled';theatreId:string;teamId:string;pacuId:string;setId:string};
export type SterileSet={id:string;status:'sterile'|'reserved'|'dirty'|'cleaned'|'quarantined';caseId:string|null;cycleId:string|null;cyclePassed:boolean|null};
export type Referral={id:string;patientId:string;origin:string;care:'ward'|'icu';status:'requested'|'accepted'|'in_transit'|'arrived'|'handed_over'|'cancelled';delivery:'queued'|'sent'|'acknowledged';route:'wan'|'satellite'|'radio'|null;handoverId:string|null};
export type Evidence={id:string;gate:string;artifactDigest:string;result:'pass'|'fail';configurationVersion:number;expiresMinute:number;actor:Role;scope:'synthetic'};
export type Command={requestId:string;expectedVersion:number;actor:Role;action:string;args:Record<string,unknown>};
export type State={
  modelVersion:2;protocol:typeof PROTOCOL;profile:Profile;version:number;configurationVersion:number;minute:number;
  patients:Patient[];icu:IcuAssignment[];cases:SurgicalCase[];sets:SterileSet[];labs:LabOrder[];referrals:Referral[];devices:Device[];
  dependencies:Record<DependencyKey,{value:number|null;at:number;validFor:number}>;
  links:{wan:boolean;satellite:boolean;radio:boolean};stock:{labKits:number;surgicalPacks:number;labUsed:number;surgicalUsed:number};
  telemetry:ReturnType<typeof parseTelemetry>[];evidence:Evidence[];
  receipts:{requestId:string;fingerprint:string;appliedVersion:number}[];
  events:{sequence:number;minute:number;action:string;actor:Role;requestId:string}[];
};
export const GATES=['runtime-recovery','identity-security','lab-correlation','icu-dependencies','surgery-sterility','referral-handover','device-bench','clinical-review'] as const;
export const ACTIONS:Record<string,{role:Role[];fields:string[]}>= {
  'patient.arrive':{role:['operator','coordinator'],fields:['patientId']},
  'ward.admit':{role:['operator'],fields:['patientId']},
  'icu.admit':{role:['operator'],fields:['patientId']},
  'icu.stepdown':{role:['operator'],fields:['patientId']},
  'patient.discharge':{role:['operator'],fields:['patientId']},
  'dependency.set':{role:['operator'],fields:['key','value','validForMinutes']},
  'clock.advance':{role:['operator'],fields:['minutes']},
  'link.set':{role:['operator'],fields:['link','available']},
  'lab.order':{role:['operator','lab'],fields:['orderId','patientId','specimenId','test','referringFacility']},
  'lab.receive':{role:['lab'],fields:['orderId']},
  'lab.process':{role:['lab'],fields:['orderId']},
  'lab.cancel':{role:['operator','lab'],fields:['orderId']},
  'lab.release':{role:['lab'],fields:['orderId','status','critical']},
  'lab.intake':{role:['lab'],fields:['report']},
  'lab.fhir-intake':{role:['lab'],fields:['orderId','bundle','critical']},
  'lab.acknowledge':{role:['operator'],fields:['orderId','revision']},
  'surgery.book':{role:['theatre'],fields:['caseId','patientId']},
  'surgery.start':{role:['theatre'],fields:['caseId']},
  'surgery.finish':{role:['theatre'],fields:['caseId']},
  'surgery.recover':{role:['theatre'],fields:['caseId']},
  'surgery.cancel':{role:['theatre'],fields:['caseId']},
  'sterile.clean':{role:['theatre'],fields:['setId']},
  'sterile.cycle':{role:['theatre'],fields:['setId','cycleId','passed']},
  'sterile.release':{role:['reviewer'],fields:['setId','cycleId']},
  'referral.request':{role:['coordinator'],fields:['referralId','patientId','origin','care']},
  'referral.send':{role:['coordinator'],fields:['referralId','route']},
  'referral.acknowledge':{role:['coordinator'],fields:['referralId']},
  'referral.accept':{role:['coordinator'],fields:['referralId']},
  'referral.depart':{role:['coordinator'],fields:['referralId']},
  'referral.arrive':{role:['coordinator'],fields:['referralId']},
  'referral.handover':{role:['operator'],fields:['referralId','handoverId']},
  'referral.cancel':{role:['coordinator'],fields:['referralId']},
  'device.fail':{role:['biomed'],fields:['deviceId']},
  'device.restore-simulation':{role:['biomed'],fields:['deviceId']},
  'device.observe':{role:['biomed'],fields:['observation']},
  'evidence.record':{role:['reviewer'],fields:['id','gate','artifactDigest','result','configurationVersion','validForMinutes','scope']},
};
export function decodeCommand(input:unknown):Command {
  const c=fields(input,['requestId','expectedVersion','actor','action','args']);
  const action=choice(c.action,Object.keys(ACTIONS));const spec=ACTIONS[action]!;
  return {requestId:identifier(c.requestId),expectedVersion:integer(c.expectedVersion,0,5000),actor:choice(c.actor,ROLES),action,args:fields(c.args,spec.fields)};
}
const ids=(prefix:string,n:number)=>Array.from({length:n},(_,i)=>`${prefix}-${String(i+1).padStart(3,'0')}`);
export function seed(profileId:unknown='emt3-research-v2'):State {
  const p=profile(profileId);
  const values:Record<DependencyKey,number>={icuNurses:Math.ceil(p.icuBeds/2),intensivists:p.icuBeds?1:0,wardNurses:Math.ceil(p.wardBeds/8),powerSlots:p.icuBeds,oxygenSlots:p.icuBeds,suctionSlots:p.icuBeds,labAvailable:1,bloodAvailable:1,theatreTeams:p.theatres,pacuNurses:Math.ceil(p.pacuBays/2),waterAvailable:1,sterilizerAvailable:1,imagingAvailable:1,theatrePowerAvailable:1,theatreOxygenAvailable:1};
  const devices:Device[]=[];
  for(const kind of ['ventilator','monitor'] as const)for(const id of ids(`SIM-DEVICE-${kind.toUpperCase()}`,p.icuBeds))devices.push({id,kind,status:'simulated-ready',assignedTo:null,lastSequence:0,lastObservedMinute:null});
  devices.push({id:'SIM-DEVICE-GATEWAY-001',kind:'gateway',status:'simulated-ready',assignedTo:null,lastSequence:0,lastObservedMinute:null});
  return {modelVersion:MODEL_VERSION,protocol:PROTOCOL,profile:p,version:0,configurationVersion:1,minute:0,patients:[],icu:[],cases:[],labs:[],referrals:[],devices,
    sets:ids('SIM-SET',p.sterileSets).map(id=>({id,status:'sterile',caseId:null,cycleId:null,cyclePassed:null})),
    dependencies:Object.fromEntries(DEPENDENCIES.map(k=>[k,{value:values[k],at:0,validFor:480}])) as State['dependencies'],links:{wan:true,satellite:false,radio:true},
    stock:{labKits:120,surgicalPacks:20,labUsed:0,surgicalUsed:0},telemetry:[],evidence:[],receipts:[],events:[]};
}
function dep(s:State,k:DependencyKey):number|null {
  const d=s.dependencies[k];return d.value===null||d.at>s.minute||s.minute>=d.at+d.validFor?null:d.value;
}
function support(s:State,keys:DependencyKey[]) {return keys.every(k=>(dep(s,k)??0)>0);}
export function readiness(s:State) {
  const values:Record<string,number|null>={beds:s.profile.icuBeds,nursing:dep(s,'icuNurses')===null?null:dep(s,'icuNurses')!*2,
    intensivist:dep(s,'intensivists')===null?null:(dep(s,'intensivists')!>0?s.profile.icuBeds:0),
    ventilators:s.devices.filter(d=>d.kind==='ventilator'&&d.status==='simulated-ready').length,
    monitors:s.devices.filter(d=>d.kind==='monitor'&&d.status==='simulated-ready').length,
    power:dep(s,'powerSlots'),oxygen:dep(s,'oxygenSlots'),suction:dep(s,'suctionSlots'),
    laboratory:dep(s,'labAvailable')===null?null:(dep(s,'labAvailable')!>0?s.profile.icuBeds:0),
    blood:dep(s,'bloodAvailable')===null?null:(dep(s,'bloodAvailable')!>0?s.profile.icuBeds:0)};
  const unknown=Object.entries(values).filter(([,v])=>v===null).map(([k])=>k);
  const supported=unknown.length?0:Math.min(...Object.values(values) as number[]);
  const atRisk=s.icu.filter(a=>[a.ventilatorId,a.monitorId].some(id=>s.devices.find(d=>d.id===id)?.status!=='simulated-ready')).map(a=>a.patientId);
  const freeReadyDevices=Math.min(...(['ventilator','monitor'] as const).map(kind=>s.devices.filter(d=>d.kind===kind&&d.status==='simulated-ready'&&!d.assignedTo).length));
  return {mode:'synthetic',clinicalUseAllowed:false,values,unknown,supported,committed:s.icu.length,
    available:Math.max(0,Math.min(supported-s.icu.length,freeReadyDevices)),overcommitted:Math.max(0,s.icu.length-supported),atRisk,
    wardOccupied:s.patients.filter(p=>p.wardBed).length,wardSupported:Math.min(s.profile.wardBeds,(dep(s,'wardNurses')??0)*8),
    note:'Scenario capacity upper bound, not a clinical admission recommendation. Existing assignments are never removed automatically.'};
}
function patient(s:State,id:unknown):Patient {const p=s.patients.find(p=>p.id===syntheticId(id));requireThat(p,'patient_not_found');return p;}
function lab(s:State,id:unknown):LabOrder {const o=s.labs.find(o=>o.id===syntheticId(id));requireThat(o,'lab_order_not_found');return o;}
function surgical(s:State,id:unknown):SurgicalCase {const c=s.cases.find(c=>c.id===syntheticId(id));requireThat(c,'case_not_found');return c;}
function sterile(s:State,id:unknown):SterileSet {const set=s.sets.find(x=>x.id===syntheticId(id));requireThat(set,'set_not_found');return set;}
function referral(s:State,id:unknown):Referral {const r=s.referrals.find(x=>x.id===syntheticId(id));requireThat(r,'referral_not_found');return r;}
function addPatient(s:State,id:unknown,location:Patient['location']) {
  const pid=syntheticId(id);requireThat(!s.patients.some(p=>p.id===pid),'duplicate_patient');requireThat(s.patients.length<s.profile.maxPatients,'patient_limit');
  const p:Patient={id:pid,location,wardBed:null};s.patients.push(p);return p;
}
function reserveWard(s:State,p:Patient) {
  const r=readiness(s);requireThat(r.wardOccupied<r.wardSupported,'ward_capacity');
  const bed=ids('WARD',s.profile.wardBeds).find(id=>!s.patients.some(p=>p.wardBed===id));requireThat(bed,'ward_full');p.wardBed=bed;
}
function reserveIcu(s:State,p:Patient) {
  requireThat(readiness(s).available>0,'icu_dependencies_unavailable');requireThat(!s.icu.some(a=>a.patientId===p.id),'already_in_icu');
  const bed=ids('ICU',s.profile.icuBeds).find(id=>!s.icu.some(a=>a.bedId===id));requireThat(bed,'icu_full');
  const v=s.devices.find(d=>d.kind==='ventilator'&&d.status==='simulated-ready'&&!d.assignedTo),m=s.devices.find(d=>d.kind==='monitor'&&d.status==='simulated-ready'&&!d.assignedTo);
  requireThat(v&&m,'devices_unavailable');v.assignedTo=p.id;m.assignedTo=p.id;
  s.icu.push({patientId:p.id,bedId:bed,ventilatorId:v.id,monitorId:m.id});
}
function releaseIcu(s:State,p:Patient) {s.icu=s.icu.filter(a=>a.patientId!==p.id);for(const d of s.devices)if(d.assignedTo===p.id)d.assignedTo=null;}
function bool(v:unknown):boolean {if(typeof v!=='boolean')throw new ResearchError(400,'invalid_boolean','Expected boolean');return v;}
function storeReport(s:State,o:LabOrder,r:LabReport) {
  requireThat(o.status!=='cancelled','cancelled_order_result_requires_review');
  requireThat(['processing','released'].includes(o.status),'specimen_not_processed');
  r.components.sort((a,b)=>a.code<b.code?-1:a.code>b.code?1:0);
  const duplicate=o.reports.find(x=>x.revision===r.revision);
  if(duplicate){requireThat(canonical({status:duplicate.status,critical:duplicate.critical,components:duplicate.components})===canonical({status:r.status,critical:r.critical,components:r.components}),'report_content_conflict');return;}
  const previous=o.reports.at(-1);requireThat(r.revision===(previous?.revision??0)+1,'report_revision_conflict');
  if(previous?.status==='final'||previous?.status==='amended')requireThat(r.status==='amended','final_result_requires_amendment');
  if(!previous||previous.status==='preliminary')requireThat(r.status!=='amended','nothing_to_amend');
  r.releasedAt=s.minute;o.reports.push(r);if(r.status!=='preliminary')o.status='released';
}
export function apply(original:State,input:unknown):State {
  const c=decodeCommand(input),spec=ACTIONS[c.action]!;
  requireThat(spec.role.includes(c.actor),'role_not_permitted','Role is a simulation selector, not a production credential');
  const fingerprint=canonical({action:c.action,actor:c.actor,args:c.args});
  const prior=original.receipts.find(r=>r.requestId===c.requestId);
  if(prior){requireThat(prior.fingerprint===fingerprint,'idempotency_conflict');return original;}
  requireThat(original.version===c.expectedVersion,'stale_version');
  requireThat(original.receipts.length<original.profile.maxCommands,'command_limit');
  const s=structuredClone(original),a=c.args;
  switch(c.action){
    case 'patient.arrive':addPatient(s,a.patientId,'waiting');break;
    case 'ward.admit':{const p=patient(s,a.patientId);requireThat(p.location==='waiting','invalid_patient_location');reserveWard(s,p);p.location='ward';break;}
    case 'icu.admit':{const p=patient(s,a.patientId);requireThat(['waiting','ward'].includes(p.location),'invalid_patient_location');requireThat(!s.cases.some(x=>x.patientId===p.id&&['booked','operating','recovery'].includes(x.status)),'active_surgical_case');reserveIcu(s,p);p.wardBed=null;p.location='icu';break;}
    case 'icu.stepdown':{const p=patient(s,a.patientId);requireThat(p.location==='icu','not_in_icu');reserveWard(s,p);releaseIcu(s,p);p.location='ward';break;}
    case 'patient.discharge':{const p=patient(s,a.patientId);requireThat(['ward','waiting'].includes(p.location),'cannot_discharge_from_this_location');requireThat(!s.cases.some(x=>x.patientId===p.id&&['booked','operating','recovery'].includes(x.status)),'active_surgical_case');requireThat(!s.referrals.some(r=>r.patientId===p.id&&r.status==='arrived'),'handover_required');requireThat(!s.labs.some(o=>o.patientId===p.id&&o.reports.at(-1)?.critical&&!o.reports.at(-1)?.acknowledgedBy),'critical_result_unacknowledged');p.location='discharged';p.wardBed=null;break;}
    case 'dependency.set':{const k=choice(a.key,DEPENDENCIES);s.dependencies[k]={value:a.value===null?null:integer(a.value,0,200),at:s.minute,validFor:integer(a.validForMinutes,1,1440)};s.configurationVersion++;break;}
    case 'clock.advance':s.minute+=integer(a.minutes,1,1440);requireThat(s.minute<=s.profile.missionDays*1440,'mission_window_exceeded');break;
    case 'link.set':s.links[choice(a.link,['wan','satellite','radio'] as const)]=bool(a.available);break;
    case 'lab.order':{const p=patient(s,a.patientId);requireThat(p.location!=='discharged','patient_discharged');const id=syntheticId(a.orderId),specimenId=syntheticId(a.specimenId),test=choice(a.test,TESTS);requireThat(!s.labs.some(o=>o.id===id),'duplicate_lab_order');requireThat(!s.labs.some(o=>o.specimenId===specimenId&&o.patientId!==p.id),'specimen_patient_conflict');requireThat(s.labs.length<400,'lab_limit');if(s.profile.icuBeds===0)requireThat(test==='hemoglobin','test_not_in_profile');s.labs.push({id,patientId:p.id,specimenId,test,referringFacility:syntheticId(a.referringFacility),status:'ordered',custody:[{action:'ordered',at:s.minute,actor:c.actor}],reports:[]});break;}
    case 'lab.receive':{const o=lab(s,a.orderId);requireThat(o.status==='ordered','invalid_specimen_transition');o.status='received';o.custody.push({action:'received',at:s.minute,actor:c.actor});break;}
    case 'lab.process':{const o=lab(s,a.orderId);requireThat(o.status==='received','specimen_not_received');requireThat(support(s,['labAvailable','waterAvailable']),'lab_unavailable');requireThat(s.stock.labKits>0,'lab_stock_empty');s.stock.labKits--;s.stock.labUsed++;o.status='processing';o.custody.push({action:'processing',at:s.minute,actor:c.actor});break;}
    case 'lab.cancel':{const o=lab(s,a.orderId);requireThat(['ordered','received'].includes(o.status),'cannot_cancel_processed_specimen');o.status='cancelled';break;}
    case 'lab.release':{const o=lab(s,a.orderId);requireThat(o.reports.length<100,'report_limit');storeReport(s,o,syntheticReport(o.test,(o.reports.at(-1)?.revision??0)+1,choice(a.status,['preliminary','final','amended'] as const),bool(a.critical),s.minute));break;}
    case 'lab.intake':{const raw=fields(a.report,['orderId','patientId','specimenId','test','revision','status','critical','components']);const o=lab(s,raw.orderId);requireThat(o.reports.length<100,'report_limit');storeReport(s,o,intake(raw,o));break;}
    case 'lab.fhir-intake':{const o=lab(s,a.orderId);requireThat(o.reports.length<100,'report_limit');storeReport(s,o,fromFhirBundle(a.bundle,o,bool(a.critical)));break;}
    case 'lab.acknowledge':{const o=lab(s,a.orderId),r=o.reports.at(-1);requireThat(r&&r.revision===integer(a.revision,1,100),'stale_report_acknowledgment');requireThat(r.status!=='preliminary','cannot_acknowledge_preliminary');r.acknowledgedBy=c.actor;break;}
    case 'surgery.book':{
      const p=patient(s,a.patientId);requireThat(p.location==='ward','ward_bed_required');const id=syntheticId(a.caseId);
      requireThat(s.cases.length<200&&!s.cases.some(x=>x.id===id),'case_limit_or_duplicate');requireThat(!s.cases.some(x=>x.patientId===p.id&&!['completed','cancelled'].includes(x.status)),'active_surgical_case');
      requireThat(support(s,['theatreTeams','pacuNurses','labAvailable','bloodAvailable','waterAvailable','imagingAvailable','theatrePowerAvailable','theatreOxygenAvailable']),'surgery_dependencies');
      const active=s.cases.filter(x=>['booked','operating'].includes(x.status)),recovering=s.cases.filter(x=>['booked','operating','recovery'].includes(x.status));
      const theatreId=ids('OR',s.profile.theatres).find(id=>!active.some(x=>x.theatreId===id));
      const teamId=ids('TEAM',Math.min(s.profile.theatres,dep(s,'theatreTeams')??0)).find(id=>!active.some(x=>x.teamId===id));
      const pacuId=ids('PACU',Math.min(s.profile.pacuBays,(dep(s,'pacuNurses')??0)*2)).find(id=>!recovering.some(x=>x.pacuId===id));
      const set=s.sets.find(x=>x.status==='sterile');requireThat(theatreId&&teamId&&pacuId&&set,'surgical_resources_unavailable');
      set.status='reserved';set.caseId=id;s.cases.push({id,patientId:p.id,status:'booked',theatreId,teamId,pacuId,setId:set.id});break;
    }
    case 'surgery.start':{const x=surgical(s,a.caseId);requireThat(x.status==='booked','case_not_booked');requireThat(support(s,['theatreTeams','pacuNurses','labAvailable','bloodAvailable','waterAvailable','imagingAvailable','theatrePowerAvailable','theatreOxygenAvailable']),'surgery_dependencies');requireThat(s.stock.surgicalPacks>0,'surgical_stock_empty');requireThat(s.cases.filter(x=>['booked','operating'].includes(x.status)).length<=(dep(s,'theatreTeams')??0),'team_coverage_changed');requireThat(s.cases.filter(x=>['booked','operating','recovery'].includes(x.status)).length<=(dep(s,'pacuNurses')??0)*2,'pacu_coverage_changed');s.stock.surgicalPacks--;s.stock.surgicalUsed++;x.status='operating';patient(s,x.patientId).location='theatre';break;}
    case 'surgery.finish':{const x=surgical(s,a.caseId);requireThat(x.status==='operating','case_not_operating');x.status='recovery';patient(s,x.patientId).location='pacu';const set=sterile(s,x.setId);set.status='dirty';set.caseId=null;set.cycleId=null;set.cyclePassed=null;break;}
    case 'surgery.recover':{const x=surgical(s,a.caseId);requireThat(x.status==='recovery','case_not_in_recovery');x.status='completed';patient(s,x.patientId).location='ward';break;}
    case 'surgery.cancel':{const x=surgical(s,a.caseId);requireThat(x.status==='booked','cannot_undo_surgery');x.status='cancelled';const set=sterile(s,x.setId);set.status='sterile';set.caseId=null;break;}
    case 'sterile.clean':{const set=sterile(s,a.setId);requireThat(['dirty','quarantined'].includes(set.status),'set_not_dirty');requireThat(support(s,['waterAvailable']),'water_unavailable');set.status='cleaned';set.cycleId=null;set.cyclePassed=null;break;}
    case 'sterile.cycle':{const set=sterile(s,a.setId);requireThat(set.status==='cleaned','set_not_cleaned');requireThat(support(s,['waterAvailable','sterilizerAvailable']),'sterilizer_unavailable');const cycle=syntheticId(a.cycleId);requireThat(!s.sets.some(x=>x.cycleId===cycle),'cycle_id_conflict');set.status='quarantined';set.cycleId=cycle;set.cyclePassed=bool(a.passed);break;}
    case 'sterile.release':{const set=sterile(s,a.setId);requireThat(set.status==='quarantined'&&set.cyclePassed&&set.cycleId===syntheticId(a.cycleId),'cycle_not_releasable');set.status='sterile';break;}
    case 'referral.request':{const id=syntheticId(a.referralId);requireThat(s.referrals.length<200&&!s.referrals.some(x=>x.id===id),'referral_limit_or_duplicate');const p=addPatient(s,a.patientId,'external');s.referrals.push({id,patientId:p.id,origin:syntheticId(a.origin),care:choice(a.care,['ward','icu'] as const),status:'requested',delivery:'queued',route:null,handoverId:null});break;}
    case 'referral.send':{const r=referral(s,a.referralId);requireThat(r.delivery==='queued'&&r.status!=='cancelled','message_not_queued');const route=choice(a.route,['wan','satellite','radio'] as const);requireThat(s.links[route],'communications_unavailable');r.route=route;r.delivery='sent';break;}
    case 'referral.acknowledge':{const r=referral(s,a.referralId);requireThat(r.delivery==='sent','message_not_sent');r.delivery='acknowledged';break;}
    case 'referral.accept':{const r=referral(s,a.referralId);requireThat(r.status==='requested'&&r.delivery==='acknowledged','referral_not_confirmed');const p=patient(s,r.patientId);if(r.care==='icu')reserveIcu(s,p);else reserveWard(s,p);r.status='accepted';break;}
    case 'referral.depart':{const r=referral(s,a.referralId);requireThat(r.status==='accepted','referral_not_accepted');r.status='in_transit';break;}
    case 'referral.arrive':{const r=referral(s,a.referralId);requireThat(r.status==='in_transit','referral_not_in_transit');r.status='arrived';patient(s,r.patientId).location=r.care;break;}
    case 'referral.handover':{const r=referral(s,a.referralId);requireThat(r.status==='arrived','patient_not_arrived');r.handoverId=syntheticId(a.handoverId);r.status='handed_over';break;}
    case 'referral.cancel':{const r=referral(s,a.referralId);requireThat(['requested','accepted'].includes(r.status),'cannot_cancel_in_transit');r.status='cancelled';const p=patient(s,r.patientId);releaseIcu(s,p);p.wardBed=null;break;}
    case 'device.fail':case 'device.restore-simulation':{const d=s.devices.find(d=>d.id===syntheticId(a.deviceId));requireThat(d,'device_not_found');d.status=c.action==='device.fail'?'failed':'simulated-ready';s.configurationVersion++;break;}
    case 'device.observe':{const o=parseTelemetry(a.observation),d=s.devices.find(d=>d.id===o.deviceId);requireThat(d,'device_not_found');requireThat(o.sequence>d.lastSequence,'telemetry_sequence_replay');requireThat(o.observedMinute<=s.minute&&(d.lastObservedMinute===null||o.observedMinute>=d.lastObservedMinute),'telemetry_time_invalid');d.lastSequence=o.sequence;d.lastObservedMinute=o.observedMinute;s.telemetry.push(o);s.telemetry=s.telemetry.slice(-100);break;}
    case 'evidence.record':{requireThat(a.scope==='synthetic','synthetic_evidence_only');const id=syntheticId(a.id);requireThat(!s.evidence.some(e=>e.id===id)&&s.evidence.length<100,'evidence_duplicate_or_limit');requireThat(typeof a.artifactDigest==='string'&&/^[0-9a-f]{64}$/.test(a.artifactDigest),'artifact_digest_required');const cv=integer(a.configurationVersion,1,5000);requireThat(cv===s.configurationVersion,'evidence_configuration_mismatch');s.evidence.push({id,gate:choice(a.gate,GATES),artifactDigest:a.artifactDigest,result:choice(a.result,['pass','fail'] as const),configurationVersion:cv,expiresMinute:s.minute+integer(a.validForMinutes,1,1440),actor:c.actor,scope:'synthetic'});break;}
  }
  s.version++;s.receipts.push({requestId:c.requestId,fingerprint,appliedVersion:s.version});s.events.push({sequence:s.version,minute:s.minute,action:c.action,actor:c.actor,requestId:c.requestId});
  assertInvariants(s);return s;
}
export function assertInvariants(s:State) {
  const unique=(xs:string[])=>new Set(xs).size===xs.length;
  requireThat(s.modelVersion===2&&s.protocol===PROTOCOL,'wrong_model');
  requireThat(unique(s.patients.map(p=>p.id))&&s.patients.length<=s.profile.maxPatients,'patient_invariant');
  requireThat(unique(s.patients.flatMap(p=>p.wardBed?[p.wardBed]:[])),'ward_exclusivity');
  requireThat(unique(s.icu.map(x=>x.patientId))&&unique(s.icu.map(x=>x.bedId))&&s.icu.length<=s.profile.icuBeds,'icu_exclusivity');
  requireThat(unique(s.icu.flatMap(x=>[x.ventilatorId,x.monitorId])),'device_exclusivity');
  for(const a of s.icu){const p=patient(s,a.patientId);requireThat(!p.wardBed&&['icu','external'].includes(p.location),'icu_patient_location');for(const id of [a.ventilatorId,a.monitorId])requireThat(s.devices.find(d=>d.id===id)?.assignedTo===p.id,'device_assignment_invariant');}
  for(const p of s.patients){if(['ward','theatre','pacu'].includes(p.location))requireThat(p.wardBed,'missing_ward_reservation');if(p.location==='icu')requireThat(s.icu.some(a=>a.patientId===p.id),'missing_icu_assignment');}
  for(const d of s.devices)if(d.assignedTo)requireThat(s.icu.some(a=>a.patientId===d.assignedTo&&[a.ventilatorId,a.monitorId].includes(d.id)),'orphan_device_assignment');
  const active=s.cases.filter(x=>['booked','operating'].includes(x.status)),recovery=s.cases.filter(x=>['booked','operating','recovery'].includes(x.status));
  requireThat(unique(active.map(x=>x.theatreId))&&unique(active.map(x=>x.teamId))&&unique(active.map(x=>x.setId)),'theatre_exclusivity');requireThat(unique(recovery.map(x=>x.pacuId)),'pacu_exclusivity');
  for(const x of active)requireThat(sterile(s,x.setId).status==='reserved'&&sterile(s,x.setId).caseId===x.id,'sterile_set_assignment');
  requireThat(s.stock.labKits>=0&&s.stock.surgicalPacks>=0&&s.stock.labKits+s.stock.labUsed===120&&s.stock.surgicalPacks+s.stock.surgicalUsed===20,'stock_conservation');
  requireThat(s.version===s.receipts.length&&s.version===s.events.length&&unique(s.receipts.map(r=>r.requestId)),'journal_invariant');
  for(const o of s.labs){patient(s,o.patientId);requireThat(o.reports.every((r,i)=>r.revision===i+1),'report_revision_invariant');}
}
export function evidenceStatus(s:State) {
  return {clinicalUseAllowed:false,whoClassification:'not-assessed',gates:GATES.map(gate=>{
    const e=s.evidence.filter(e=>e.gate===gate).at(-1);
    const status=!e?'missing':e.configurationVersion!==s.configurationVersion?'stale-configuration':e.expiresMinute<=s.minute?'expired':e.result==='fail'?'failed':'synthetic-pass-only';
    return {gate,status,artifactDigest:e?.artifactDigest??null,externalApprovalRequired:true};
  }),note:'Even all synthetic passes do not authorize real patients, clinical use, or WHO verification.'};
}
export function replay(profileId:unknown,commands:unknown[]):State {let s=seed(profileId);for(const c of commands)s=apply(s,c);return s;}
