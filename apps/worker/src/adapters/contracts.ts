/** Capability-first adapter contracts. No generic "FHIR server does everything" assumption. */
export type AdapterCapability =
  | 'patient.read' | 'patient.register' | 'patient.link'
  | 'lab.order.create' | 'lab.order.lookup' | 'lab.order.cancel'
  | 'lab.result.poll' | 'lab.result.subscribe'
  | 'imaging.worklist' | 'imaging.study.lookup'
  | 'inventory.lot.read' | 'inventory.dispense.record';

export interface AdapterManifest {
  id: string;
  product: string;
  supportedVersions: readonly string[];
  capabilities: readonly AdapterCapability[];
  protocol: 'FHIR_R4'|'HL7_V2'|'DICOMWEB'|'REST'|'SIMULATOR';
  offlineCapable: boolean;
  requiresExternalIdentityProvider: boolean;
  conformanceSuite: string;
}
export type ExternalLabOrder = {
  key:string; hash:string; patientId:string; testCode:string;
};
export type DestinationOrder = {
  id:string; idempotency_key:string; payload_hash:string; state:string;
};
export interface LaboratoryAdapter {
  readonly manifest: AdapterManifest;
  lookupByKey(key:string):Promise<DestinationOrder|null>;
  submit(order:ExternalLabOrder):Promise<DestinationOrder>;
}
export interface PatientAdapter {
  readonly manifest: AdapterManifest;
  resolveExternalIdentifier(system:string,value:string):Promise<string|null>;
  // Never auto-merge two patients from a fuzzy matching score.
}
export interface ImagingAdapter {
  readonly manifest: AdapterManifest;
  getStudyByAccession(accession:string):Promise<{studyUid:string}|null>;
}
