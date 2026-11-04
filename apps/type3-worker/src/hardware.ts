import { fields, integer, choice, text, requireThat } from './protocol.js';
export const DEVICE_KINDS=['ventilator','monitor','analyzer','ultrasound','sterilizer','incubator','gateway'] as const;
export type DeviceKind=typeof DEVICE_KINDS[number];
export type Device={id:string;kind:DeviceKind;status:'simulated-ready'|'quarantine'|'failed'|'retired';assignedTo:string|null;lastSequence:number;lastObservedMinute:number|null};
export const PURCHASE_CHECKS=['identity','decontamination','accessories','interfaceDocumentation','licenseTransfer','consumables','serviceSupport','recallReview','dataSanitization','benchTest'] as const;
export type Procurement = {currency:'USD';costs:Record<string,number|null>;checks:Record<string,'verified'|'missing'|'unknown'>};
/** Costs are user-entered cents, not current market quotes; missing costs never become zero. */
export function evaluateProcurement(input:unknown) {
  const p=fields(input,['currency','costs','checks']);choice(p.currency,['USD'] as const);
  const costKeys=['bid','premium','tax','freight','accessories','service','consumables','disposal'];
  const costs=fields(p.costs,costKeys),checks=fields(p.checks,[...PURCHASE_CHECKS]);
  for(const k of costKeys)if(costs[k]!==null)integer(costs[k],0,100_000_000);
  for(const k of PURCHASE_CHECKS)choice(checks[k],['verified','missing','unknown'] as const);
  const unknownCosts=costKeys.filter(k=>costs[k]===null);
  const blockers=PURCHASE_CHECKS.filter(k=>checks[k]!=='verified');
  return {currency:'USD',knownSubtotalCents:costKeys.reduce((s,k)=>s+(costs[k] as number??0),0),
    landedCostCents:unknownCosts.length?null:costKeys.reduce((s,k)=>s+(costs[k] as number),0),unknownCosts,blockers,
    disposition:blockers.length||unknownCosts.length?'hold':'eligible-for-supervised-bench-evaluation',clinicalUseAllowed:false,
    note:'A passing buying screen is neither a purchase nor biomedical/clinical acceptance.'};
}
export function parseTelemetry(input:unknown) {
  const o=fields(input,['deviceId','sequence','observedMinute','mode','metric','value']);
  requireThat(o.mode==='synthetic','synthetic_telemetry_only');
  const deviceId=text(o.deviceId);requireThat(/^SIM-DEVICE-[A-Z0-9_-]+$/.test(deviceId),'invalid_device');
  return {deviceId,sequence:integer(o.sequence,1,1_000_000),observedMinute:integer(o.observedMinute,0,50_000),
    metric:choice(o.metric,['heartbeat','battery-percent'] as const),value:integer(o.value,0,100),mode:'synthetic' as const};
}
