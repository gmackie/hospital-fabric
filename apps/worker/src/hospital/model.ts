/** Scripted synthetic operations, never clinical decisions or recommendations. */
export type Stage = 'registration'|'assessment'|'lab_queued'|'lab_unknown'|'lab_accepted'|'imaging'|'review'|'ward'|'theatre'|'recovery'|'pharmacy'|'discharged';
export type Journey = 'outpatient'|'medical'|'surgical';
export type Patient = { id:string; name:string; journey:Journey; stage:Stage; bed:string|null; labId:string|null; result:string|null; image:string|null; dispensed:boolean; arrived:number };
export type Command = { requestId:string; version:number; action:'advance'|'arrival'|'wan'|'clock'|'resupply'; patientId?:string };
export type Hospital = { minute:number; wan:boolean; patients:Patient[]; beds:string[]; stock:number; initialStock:number; warehouse:number; labOrders:{id:string;patientId:string;accepted:boolean}[]; referrals:number; events:{at:number;patientId:string|null;department:string;text:string}[]; receipts:{id:string;fingerprint:string}[] };
export class SimulationError extends Error { constructor(public status:number, public code:string, message:string) { super(message); } }
const names = ['Alex Demo','Robin Demo','Sam Demo','Taylor Demo','Morgan Demo','Jordan Demo','Casey Demo','Jamie Demo','Avery Demo','Riley Demo','Drew Demo','Quinn Demo'];
export const departments = ['Registration','Emergency & outpatient','Laboratory','Imaging','Ward','Theatre','Pharmacy','Discharge'];
export function department(p:Patient):string {
  if (p.stage==='registration') return departments[0]!;
  if (p.stage==='assessment'||p.stage==='review') return departments[1]!;
  if (p.stage.startsWith('lab_')) return departments[2]!;
  if (p.stage==='imaging') return departments[3]!;
  if (p.stage==='ward'||p.stage==='recovery') return departments[4]!;
  if (p.stage==='theatre') return departments[5]!;
  if (p.stage==='pharmacy') return departments[6]!;
  return departments[7]!;
}
function event(s:Hospital,p:Patient|null,d:string,text:string) { s.events.push({at:s.minute,patientId:p?.id??null,department:d,text}); s.events=s.events.slice(-120); }
function arrival(s:Hospital) {
  const n=s.patients.length;
  if(n>=12) throw new SimulationError(409,'arrival_limit','This hospital shift has reached its 12-patient limit.');
  const journey:Journey=(['medical','surgical','outpatient'] as const)[n%3]!;
  const p:Patient={id:`SIM-${String(n+1).padStart(3,'0')}`,name:names[n]!,journey,stage:'registration',bed:null,labId:null,result:null,image:null,dispensed:false,arrived:s.minute};
  s.patients.push(p); event(s,p,'Registration',`${p.name} arrived for a scripted ${journey} journey.`);
}
export function seedHospital():Hospital {
  const s:Hospital={minute:480,wan:true,patients:[],beds:['W-01','W-02','W-03'],stock:4,initialStock:4,warehouse:12,labOrders:[],referrals:0,events:[],receipts:[]};
  for(let i=0;i<6;i++) arrival(s);
  return s;
}
export function nextAction(p:Patient):string {
  return ({registration:'Register patient',assessment:'Request laboratory',lab_queued:'Deliver lab order',lab_unknown:'Reconcile acknowledgment',lab_accepted:'Release lab result',imaging:'Complete imaging',review:p.journey==='outpatient'?'Send to pharmacy':'Allocate ward bed',ward:p.journey==='surgical'?'Book theatre':'Complete ward stay',theatre:'Complete procedure',recovery:'Complete recovery',pharmacy:'Dispense & discharge',discharged:'Journey completed'} as Record<Stage,string>)[p.stage];
}
export function applyCommand(original:Hospital,c:Command):Hospital {
  const s=structuredClone(original);
  const fingerprint=JSON.stringify([c.action,c.patientId??null]);
  const receipt=s.receipts.find(r=>r.id===c.requestId);
  if(receipt) {
    if(receipt.fingerprint!==fingerprint) throw new SimulationError(409,'idempotency_conflict','That command ID was used for a different action.');
    return s;
  }
  if(s.receipts.length>=240) throw new SimulationError(409,'shift_complete','This simulation has reached its 240-command limit.');
  if(c.action==='arrival') arrival(s);
  else if(c.action==='wan') {s.wan=!s.wan;event(s,null,'Infrastructure',s.wan?'WAN restored; referral queue synchronized.':'WAN disconnected in the model; local departments remain available.');if(s.wan)s.referrals=0;}
  else if(c.action==='resupply') {if(s.warehouse<4)throw new SimulationError(409,'warehouse_empty','The local warehouse has no remaining resupply packs.');s.warehouse-=4;s.stock+=4;s.initialStock+=4;event(s,null,'Inventory','Four demo medicine packs moved from local warehouse to pharmacy.');}
  else if(c.action==='clock') {s.minute+=30;event(s,null,'Operations','Shift clock advanced 30 minutes. Patient work still requires explicit actions.');}
  else {
    const p=s.patients.find(p=>p.id===c.patientId);
    if(!p) throw new SimulationError(404,'patient_not_found','Choose a patient in this hospital.');
    const d=department(p);
    switch(p.stage) {
      case 'registration': p.stage='assessment';event(s,p,d,'Synthetic identity registered; encounter opened.');break;
      case 'assessment': p.stage='lab_queued';event(s,p,d,'Scripted CBC request queued with a stable correlation key.');break;
      case 'lab_queued': {
        const id=`LAB-${p.id}`;
        if(!s.labOrders.some(o=>o.id===id))s.labOrders.push({id,patientId:p.id,accepted:true});
        p.labId=id;p.stage='lab_unknown';event(s,p,d,'Laboratory saved the order; acknowledgment deliberately lost.');break;
      }
      case 'lab_unknown': {
        const order=s.labOrders.find(o=>o.id===p.labId&&o.patientId===p.id&&o.accepted);
        if(!order)throw new SimulationError(409,'unresolved_order','The original destination order cannot be verified.');
        p.stage='lab_accepted';event(s,p,d,'Original destination order found; no duplicate submission.');break;
      }
      case 'lab_accepted': p.result='Synthetic CBC · 7.5 × 10⁹/L';p.stage=p.journey==='surgical'?'imaging':'review';event(s,p,d,'Fixed synthetic result released and attached to the same encounter.');break;
      case 'imaging':p.image='Synthetic study · demonstration report';p.stage='review';event(s,p,d,'Simulated imaging study and report matched to the encounter.');break;
      case 'review': {
        if(p.journey==='outpatient'){p.stage='pharmacy';event(s,p,d,'Scripted outpatient pathway completed; dispensing request queued.');break;}
        const free=s.beds.find(b=>!s.patients.some(other=>other.bed===b));
        if(!free)throw new SimulationError(409,'ward_full','All ward beds are occupied. Complete a stay to free a bed.');
        p.bed=free;p.stage='ward';event(s,p,d,`Admitted to ${free}; bed reserved until discharge.`);break;
      }
      case 'ward': {
        if(p.journey==='surgical') {
          if(s.patients.some(other=>other.stage==='theatre'))throw new SimulationError(409,'theatre_busy','The single theatre is occupied. Complete its current procedure first.');
          p.stage='theatre';event(s,p,d,'Theatre slot reserved; ward bed retained.');
        } else {p.stage='pharmacy';event(s,p,d,'Scripted ward stay complete; discharge dispensing queued.');}
        break;
      }
      case 'theatre':p.stage='recovery';event(s,p,d,'Scripted procedure complete; theatre freed and patient returned to ward recovery.');break;
      case 'recovery':p.stage='pharmacy';event(s,p,d,'Scripted recovery completed; dispensing queued.');break;
      case 'pharmacy':
        if(s.stock<1)throw new SimulationError(409,'stock_empty','Demo medicine packs are exhausted. This shift cannot dispense more stock.');
        s.stock--;p.dispensed=true;p.bed=null;p.stage='discharged';
        if(!s.wan)s.referrals++;
        event(s,p,d,'One demo medicine pack dispensed; bed freed; encounter discharged.');
        event(s,p,'Discharge',s.wan?'Discharge summary synchronized.':'Discharge summary queued locally until WAN is restored.');break;
      case 'discharged':throw new SimulationError(409,'journey_complete','This patient has already been discharged.');
    }
    s.minute+=5;
  }
  s.receipts.push({id:c.requestId,fingerprint});
  validateHospital(s);
  return s;
}
export function validateHospital(s:Hospital) {
  const beds=s.patients.flatMap(p=>p.bed?[p.bed]:[]);
  if(new Set(beds).size!==beds.length||beds.some(b=>!s.beds.includes(b))||s.stock<0||s.warehouse<0||s.warehouse+s.initialStock!==16||s.stock+s.patients.filter(p=>p.dispensed).length!==s.initialStock||s.patients.filter(p=>p.stage==='theatre').length>1||new Set(s.labOrders.map(o=>o.id)).size!==s.labOrders.length)throw new Error('Hospital simulation invariant failed');
}
export function viewHospital(s:Hospital,version:number) {
  return {...s,receipts:undefined,version,syntheticOnly:true,patients:s.patients.map(p=>({...p,department:department(p),nextAction:nextAction(p)})),departments:departments.map(name=>({name,queue:s.patients.filter(p=>department(p)===name&&p.stage!=='discharged').map(p=>p.id)}))};
}
