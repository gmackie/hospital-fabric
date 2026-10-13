import { FhirClient, FhirProtocolError, type FhirResource } from './fhir-client';

/**
 * Real OpenMRS -> OpenELIS FHIR integration.
 * Talks to running product FHIR stores; it is NOT a fake LIS or a clinical authorization.
 * Sandbox write permissions must be enabled separately after installation-specific conformance.
 */
export type LabCatalogEntry = {
  key: string;
  loinc: string;
  specimen: string;
  enabled: boolean;
  /** Explicitly verified OpenELIS catalog entry; a LOINC match alone is insufficient. */
  openElisTestId: string;
};
export type LabCatalog = Readonly<Record<string, LabCatalogEntry>>;
export type LabRequest = {
  /** Stable immutable external ID for one requested test, generated ONCE and persisted. */
  orderNumber: string;
  patientId: string;
  patientIdentifierSystem: string;
  patientIdentifier: string;
  ownerId: string;
  authoredOn: string;
  testKey: string;
};
export type LabConnection = {
  source: FhirClient;
  results: FhirClient;
  openMrs: FhirClient;
  catalog: LabCatalog;
  /** Documented deployment-specific search behavior of OpenMRS FHIR2. */
  openMrsSearchSystem?: string;
  /** Must be backed by version-specific, recorded, actual server conformance evidence. */
  conditionalCreateVerified: boolean;
  /** Sandbox only until clinical security, governance and workflow reviews pass. */
  allowSandboxWrites: boolean;
};
export type RemoteOrder = {
  requestId: string;
  taskId: string;
  state: 'awaiting_lab' | 'accepted' | 'rejected' | 'completed' | 'needs_review';
  reportReferences: string[];
};
export type LabValue =
  | { kind: 'quantity'; value: number; system: string; code: string; unit: string }
  | { kind: 'text'; value: string }
  | { kind: 'coded'; system: string; code: string; display: string | null };
export type ResultEntry = {
  resourceId: string; version: string; loinc: string; specimenId: string;
  effectiveDateTime: string | null; value: LabValue;
};
export type ReleasedReport = {
  id: string; version: string; status: 'final' | 'amended' | 'corrected';
  patientId: string; orderNumber: string; accessionNumber: string;
  testKey: string; observations: ResultEntry[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9._-]{1,120}$/;
const LOINC = /^[0-9]{1,7}-[0-9]$/;
const ORDER_SYSTEM = 'https://hospital-fabric.example/synthetic-order';
const REFERENCE_BASE = 'https://hospital-fabric.example/synthetic-fhir/';
const object = (value: unknown, what: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FhirProtocolError('Invalid ' + what);
  return value as Record<string, unknown>;
};
const entries = (value: unknown, what: string): unknown[] => {
  if (!Array.isArray(value)) throw new FhirProtocolError('Invalid ' + what);
  return value;
};
const reference = (value: unknown, what: string): string => {
  const r = object(value, what).reference;
  if (typeof r !== 'string') throw new FhirProtocolError('Invalid reference for ' + what);
  return r;
};
const localRef = (value: unknown, type: string): string => {
  const ref = reference(value, type);
  const prefix = type + '/';
  if (!ref.startsWith(prefix) || !TOKEN.test(ref.slice(prefix.length)) ||
      ref.slice(prefix.length) === '.' || ref.slice(prefix.length) === '..') {
    throw new FhirProtocolError('Unsafe ' + type + ' reference');
  }
  return ref;
};
const coding = (resource: FhirResource): Array<{system?: string; code?: string; display?: string}> => {
  const code = object(resource.code, 'code');
  return entries(code.coding, 'codings').map(c => object(c, 'coding')) as Array<{system?: string; code?: string; display?: string}>;
};
const tagged = (resource: FhirResource, system: string, code: string): boolean =>
  coding(resource).some(c => c.system === system && c.code === code);

export function validateLiveCatalog(catalog: LabCatalog): void {
  const keys = Object.keys(catalog);
  if (!keys.length || keys.length > 300) throw new FhirProtocolError('Catalog must contain 1..300 reviewed tests');
  const idSeen = new Set<string>();
  for (const [key, test] of Object.entries(catalog)) {
    if (!TOKEN.test(key) || test.key !== key || !LOINC.test(test.loinc) ||
        !TOKEN.test(test.openElisTestId) || !test.specimen || test.specimen.length > 120 ||
        typeof test.enabled !== 'boolean') throw new FhirProtocolError('Invalid laboratory catalog entry');
    if (idSeen.has(test.openElisTestId)) throw new FhirProtocolError('Duplicate installed OpenELIS test ID');
    idSeen.add(test.openElisTestId);
  }
}

export function testFor(catalog: LabCatalog, key: string): LabCatalogEntry {
  validateLiveCatalog(catalog);
  if (!Object.hasOwn(catalog, key) || !catalog[key]?.enabled) throw new FhirProtocolError('Test not enabled in reviewed local catalog');
  return catalog[key]!;
}
export function validateLabRequest(catalog: LabCatalog, input: LabRequest, sandbox: boolean): LabCatalogEntry {
  const entry = testFor(catalog, input.testKey);
  if (!TOKEN.test(input.orderNumber) || !UUID.test(input.patientId) || !UUID.test(input.ownerId) ||
      !input.patientIdentifierSystem || input.patientIdentifierSystem.includes('|') ||
      !TOKEN.test(input.patientIdentifier) || !Number.isFinite(Date.parse(input.authoredOn))) {
    throw new FhirProtocolError('Invalid order identity, practitioner, or authored time');
  }
  if (sandbox && (!input.orderNumber.startsWith('HF-SYNTH-') || !input.patientIdentifier.startsWith('HF-SYNTH-'))) {
    throw new FhirProtocolError('Only generated synthetic identities may use the live-instance sandbox writer');
  }
  return entry;
}
/** Compose 1..N independently traceable orders; never pretend unsupported panel semantics are verified. */
export function planOrders(catalog: LabCatalog, patient: Omit<LabRequest, 'orderNumber'|'testKey'>,
                           cases: readonly {orderNumber: string;testKey: string}[], sandbox = true): LabRequest[] {
  if (!cases.length || cases.length > 20) throw new FhirProtocolError('An order batch needs 1..20 distinct test requests');
  const out = cases.map(c => ({...patient, ...c}));
  for (const order of out) validateLabRequest(catalog, order, sandbox);
  if (new Set(out.map(o => o.orderNumber)).size !== out.length) throw new FhirProtocolError('Duplicate external order number');
  return out;
}
export function buildLiveTaskBundle(input: LabRequest, test: LabCatalogEntry): FhirResource {
  const subject = {reference: 'Patient/' + input.patientId};
  const serviceUrl = REFERENCE_BASE + 'ServiceRequest/' + input.orderNumber;
  const taskUrl = REFERENCE_BASE + 'Task/' + input.orderNumber;
  const identifier = [{system: ORDER_SYSTEM, value: input.orderNumber}];
  return {resourceType:'Bundle',type:'transaction',entry:[
    {fullUrl: serviceUrl, resource:{resourceType:'ServiceRequest',identifier,status:'active',intent:'order',
      priority:'routine',code:{coding:[{system:'http://loinc.org',code:test.loinc}]},
      subject,authoredOn:input.authoredOn},
     request:{method:'POST',url:'ServiceRequest',ifNoneExist:'identifier=' + encodeURIComponent(ORDER_SYSTEM + '|' + input.orderNumber)}},
    {fullUrl: taskUrl, resource:{resourceType:'Task',identifier,status:'requested',intent:'order',
      owner:{reference:'Practitioner/' + input.ownerId},for:subject,
      basedOn:[{reference:serviceUrl}],authoredOn:input.authoredOn},
     request:{method:'POST',url:'Task',ifNoneExist:'identifier=' + encodeURIComponent(ORDER_SYSTEM + '|' + input.orderNumber)}},
  ]};
}
function exactSearch(bundle: FhirResource, type: string, number: string): FhirResource | null {
  if (bundle.resourceType !== 'Bundle' || bundle.type !== 'searchset') throw new FhirProtocolError('Unexpected FHIR search response');
  const total = bundle.total;
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0 || total > 1) throw new FhirProtocolError('Ambiguous remote identifier');
  const list = entries(bundle.entry ?? [], 'FHIR search entries');
  const links = bundle.link;
  if (links && entries(links, 'FHIR search links').some(v => object(v,'link').relation === 'next')) throw new FhirProtocolError('Paginated remote identifier');
  if (total === 0 && list.length === 0) return null;
  if (total !== 1 || list.length !== 1) throw new FhirProtocolError('Inconsistent remote search count');
  const resource = object(list[0], 'FHIR entry').resource as FhirResource | undefined;
  if (!resource || resource.resourceType !== type || typeof resource.id !== 'string' ||
      !TOKEN.test(resource.id)) throw new FhirProtocolError('Invalid search match');
  const identifiers = entries(resource.identifier, 'FHIR identifiers');
  if (!identifiers.some(x => {const id=object(x,'identifier');return id.system===ORDER_SYSTEM&&id.value===number;})) {
    throw new FhirProtocolError('Remote resource has a different external identifier');
  }
  return resource;
}
export async function reconcileLiveOrder(source: FhirClient, catalog: LabCatalog, input: LabRequest): Promise<RemoteOrder | null> {
  const test = validateLabRequest(catalog, input, false);
  const query = '?identifier=' + encodeURIComponent(ORDER_SYSTEM + '|' + input.orderNumber) + '&_count=2';
  const [sr, task] = await Promise.all([
    source.request('ServiceRequest' + query, 'Bundle').then(b=>exactSearch(b,'ServiceRequest',input.orderNumber)),
    source.request('Task' + query, 'Bundle').then(b=>exactSearch(b,'Task',input.orderNumber)),
  ]);
  if (!sr && !task) return null;
  if (!sr || !task) throw new FhirProtocolError('Partial remote order requires manual reconciliation');
  if (reference(sr.subject,'request subject') !== 'Patient/' + input.patientId ||
      !tagged(sr,'http://loinc.org',test.loinc) ||
      reference(task.for,'task subject') !== 'Patient/' + input.patientId ||
      reference(task.owner,'task owner') !== 'Practitioner/' + input.ownerId) throw new FhirProtocolError('Remote order identity conflict');
  const basedOn = entries(task.basedOn, 'task basedOn');
  if (basedOn.length !== 1 || localRef(basedOn[0], 'ServiceRequest') !== 'ServiceRequest/' + sr.id) {
    throw new FhirProtocolError('Task points to a different request');
  }
  const output = entries(task.output ?? [], 'task output');
  const reports = output.map(x => localRef(object(x,'task output').valueReference, 'DiagnosticReport'));
  if (new Set(reports).size !== reports.length) throw new FhirProtocolError('Repeated result reference');
  const statuses: Record<string,RemoteOrder['state']>={requested:'awaiting_lab',accepted:'accepted','in-progress':'accepted',rejected:'rejected'};
  const state = statuses[String(task.status)] || (task.status==='completed'&&reports.length?'completed':'needs_review');
  return {requestId:sr.id,taskId:task.id!,state,reportReferences:reports};
}
export async function stageLiveOrder(config: LabConnection, input: LabRequest): Promise<RemoteOrder> {
  const test = validateLabRequest(config.catalog,input,true);
  if (!config.allowSandboxWrites || !config.conditionalCreateVerified) {
    throw new FhirProtocolError('Sandbox order writes require explicit verified capability and approval');
  }
  // This exact Patient+Practitioner identity must already be provisioned.
  const patient = await config.source.request('Patient/' + input.patientId,'Patient');
  const identifiers = entries(patient.identifier, 'FHIR patient identifiers');
  if (patient.id !== input.patientId || !identifiers.some(v=>{const x=object(v,'identifier');return x.system===input.patientIdentifierSystem&&x.value===input.patientIdentifier;})) {
    throw new FhirProtocolError('Source Patient does not match exact expected identity');
  }
  const practitioner=await config.source.request('Practitioner/'+input.ownerId,'Practitioner');
  if(practitioner.id!==input.ownerId)throw new FhirProtocolError('Unknown laboratory owner');
  const prior=await reconcileLiveOrder(config.source,config.catalog,input);
  if(prior)return prior; // No extra POST, ever, for an already correlated remote order.
  try {
    const response=await config.source.request('', 'Bundle', {method:'POST',body:buildLiveTaskBundle(input,test)});
    const rec=entries(response.entry,'transaction receipts');
    if (response.type !== 'transaction-response' || rec.length !== 2) throw new FhirProtocolError('Uncertain order receipt');
    // HAPI can return 200 after conditional creation. Always reconcile, never claim that means lab acceptance.
    return await reconcileAfterWrite(config,input);
  } catch {
    // We cannot know if the remote transaction committed. The caller must
    // persist outcome_unknown and reconcile using the original correlation ID.
    throw new FhirProtocolError('Order outcome unknown; reconcile exact external ID before any retry');
  }
}
async function reconcileAfterWrite(config:LabConnection,input:LabRequest):Promise<RemoteOrder> {
  const result=await reconcileLiveOrder(config.source,config.catalog,input);
  if(!result)throw new FhirProtocolError('Remote write not yet visible; outcome unknown');
  return result;
}

/**
 * Consume final/amended reports created by the *OpenELIS laboratory application*.
 * NEVER send Observation/DiagnosticReport writes straight to HAPI and assume
 * OpenELIS will import those records into its UI.
 */
export async function readReleasedReports(results: FhirClient, catalog: LabCatalog, input: LabRequest,
                                         reportReferences: readonly string[]): Promise<ReleasedReport[]> {
  const expected = validateLabRequest(catalog,input,false);
  if(reportReferences.length>40)throw new FhirProtocolError('Too many remote reports');
  if(new Set(reportReferences).size!==reportReferences.length)throw new FhirProtocolError('Duplicate report reference');
  const output:ReleasedReport[]=[];
  for(const reportRef of reportReferences){
    if(!/^DiagnosticReport\/[A-Za-z0-9.-]{1,120}$/.test(reportRef))throw new FhirProtocolError('Unsafe report reference');
    const report=await results.request(reportRef,'DiagnosticReport');
    if(!report.id||reportRef!=='DiagnosticReport/'+report.id ||
       !['final','amended','corrected'].includes(String(report.status)) ||
       reference(report.subject,'report subject')!=='Patient/'+input.patientId ||
       !tagged(report,'http://loinc.org',expected.loinc))throw new FhirProtocolError('Report is not a validated matching result');
    const basedOn=entries(report.basedOn,'report basedOn');
    if(basedOn.length!==1)throw new FhirProtocolError('Report analysis reference is ambiguous');
    const analysisRef=localRef(basedOn[0],'ServiceRequest');
    const analysis=await results.request(analysisRef,'ServiceRequest');
    if(reference(analysis.subject,'analysis subject')!=='Patient/'+input.patientId ||
       analysis.status!=='completed'||!tagged(analysis,'http://loinc.org',expected.loinc) ||
       entries(analysis.basedOn,'analysis source').length!==1 ||
       localRef(entries(analysis.basedOn,'analysis source')[0],'ServiceRequest')!=='ServiceRequest/'+input.orderNumber) {
      throw new FhirProtocolError('Laboratory analysis does not belong to the original order');
    }
    const accession=object(analysis.requisition,'accession').value;
    if(typeof accession!=='string'||!TOKEN.test(accession))throw new FhirProtocolError('Missing exact laboratory accession number');
    const reportspecimens=entries(report.specimen,'report specimens');
    if(!reportspecimens.length||reportspecimens.length>20)throw new FhirProtocolError('Invalid specimen list');
    const specimenIds=reportspecimens.map(ref=>localRef(ref,'Specimen').slice('Specimen/'.length));
    const observations=entries(report.result,'report observations');
    if(!observations.length||observations.length>100)throw new FhirProtocolError('Invalid report observation count');
    const processed:ResultEntry[]=[];
    for(const obsRef of observations){
      const path=localRef(obsRef,'Observation'),obs=await results.request(path,'Observation');
      if(path!=='Observation/'+obs.id || !['final','amended','corrected'].includes(String(obs.status)) ||
         reference(obs.subject,'observation subject')!=='Patient/'+input.patientId ||
         localRef(obs.specimen,'Specimen').slice('Specimen/'.length)!==specimenIds[0] ||
         entries(obs.basedOn,'observation analysis').length!==1 ||
         localRef(entries(obs.basedOn,'observation analysis')[0],'ServiceRequest')!==analysisRef)
        throw new FhirProtocolError('Observation does not match report, patient, specimen or analysis');
      const codes=coding(obs).filter(x=>x.system==='http://loinc.org'&&LOINC.test(String(x.code)));
      if(codes.length!==1)throw new FhirProtocolError('Result is missing an unambiguous LOINC code');
      let value:LabValue;
      if(obs.valueQuantity!==undefined) {
        const quantity=object(obs.valueQuantity,'valueQuantity');
        if(typeof quantity.value!=='number'||!Number.isFinite(quantity.value) ||
           quantity.system!=='http://unitsofmeasure.org'||typeof quantity.code!=='string'||!quantity.code)
           throw new FhirProtocolError('Unsupported numeric result or non-UCUM unit');
        value={kind:'quantity',value:quantity.value,system:quantity.system,code:quantity.code,unit:String(quantity.unit??quantity.code)};
      } else if(typeof obs.valueString==='string'&&obs.valueString.length<=500) {
        value={kind:'text',value:obs.valueString};
      } else if(obs.valueCodeableConcept!==undefined) {
        const xs=entries(object(obs.valueCodeableConcept,'coded result').coding,'coded result values');
        if(xs.length!==1)throw new FhirProtocolError('Ambiguous coded result value');
        const v=object(xs[0],'coded value');
        if(typeof v.system!=='string'||typeof v.code!=='string')throw new FhirProtocolError('Unsupported coded result');
        value={kind:'coded',system:v.system,code:v.code,display:typeof v.display==='string'?v.display:null};
      } else throw new FhirProtocolError('Unsupported laboratory result value; manual review required');
      processed.push({resourceId:String(obs.id),version:String(object(obs.meta,'observation meta').versionId??''),
        loinc:String(codes[0]!.code),specimenId:specimenIds[0]!,effectiveDateTime:typeof obs.effectiveDateTime==='string'?obs.effectiveDateTime:null,value});
    }
    // Specimen subject is an independent identity check, not merely a reference label.
    for(const id of specimenIds){
      const specimen=await results.request('Specimen/'+id,'Specimen');
      if(reference(specimen.subject,'specimen subject')!=='Patient/'+input.patientId)throw new FhirProtocolError('Specimen belongs to another patient');
    }
    output.push({id:report.id,version:String(object(report.meta,'report meta').versionId??''),
      status:report.status as ReleasedReport['status'],patientId:input.patientId,
      orderNumber:input.orderNumber,accessionNumber:accession,testKey:input.testKey,observations:processed});
  }
  return output;
}
