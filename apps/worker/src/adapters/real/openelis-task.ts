import { FhirClient, FhirProtocolError, type FhirResource } from './fhir-client';

const referenceBase = 'https://hospital-fabric.example/synthetic-fhir/';
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const orderSystem = 'https://hospital-fabric.example/synthetic-order';
const id = (value: string) => /^[A-Za-z0-9.-]{1,64}$/.test(value) && value !== '.' && value !== '..';
export type SyntheticLabRequest = {
  taskId: string; requestId: string; patientId: string; ownerId: string;
  patientIdentifierSystem: string; patientIdentifier: string;
  orderNumber: string; loincCode: string; authoredOn: string;
};
function validate(input: SyntheticLabRequest) {
  if (![input.taskId,input.requestId,input.patientId,input.ownerId].every(id) ||
      !uuid(input.patientId) || !uuid(input.ownerId) ||
      !/^HF-SYNTH-[A-Za-z0-9.-]{1,64}$/.test(input.orderNumber) ||
      !/^HF-SYNTH-[A-Za-z0-9.-]{1,64}$/.test(input.patientIdentifier) ||
      !input.patientIdentifierSystem || /[|\s]/.test(input.patientIdentifierSystem) ||
      !/^\d+-\d$/.test(input.loincCode) || !Number.isFinite(Date.parse(input.authoredOn))) {
    throw new FhirProtocolError('Invalid synthetic laboratory request');
  }
}
/** Patient must already exist in this FHIR source. Never overwrite Task state on replay. */
export function buildOpenElisTaskTransaction(input: SyntheticLabRequest): FhirResource {
  validate(input);
  const patient = {reference: `Patient/${input.patientId}`};
  const serviceRequest: FhirResource = {
    resourceType: 'ServiceRequest',
    identifier: [{system: orderSystem, value: input.orderNumber}],
    status: 'active', intent: 'order', priority: 'routine',
    code: {coding: [{system:'http://loinc.org',code:input.loincCode}]}, subject: patient,
    authoredOn: input.authoredOn,
  };
  const task: FhirResource = {
    resourceType: 'Task',
    identifier: [{system: orderSystem, value: input.orderNumber}],
    status:'requested', intent:'order', owner:{reference:`Practitioner/${input.ownerId}`},
    basedOn:[{reference:`${referenceBase}ServiceRequest/${input.requestId}`}], for:patient, authoredOn:input.authoredOn,
  };
  return {resourceType:'Bundle', type:'transaction', entry:[serviceRequest,task].map(resource => ({
    fullUrl: `${referenceBase}${resource.resourceType}/${resource.resourceType === 'Task' ? input.taskId : input.requestId}`,
    resource, request:{method:'POST',url:resource.resourceType,ifNoneExist:`identifier=${encodeURIComponent(orderSystem + '|' + input.orderNumber)}`},
  }))};
}

export type LabTaskState = 'awaiting_lab' | 'accepted' | 'rejected' | 'completed' | 'needs_review';
/** Store receipt and laboratory acceptance are deliberately separate outcomes. */
export async function inspectOpenElisTask(client: FhirClient, input: SyntheticLabRequest): Promise<{state:LabTaskState; reportReferences:string[]}> {
  validate(input);
  const task = await client.request(`Task/${input.taskId}`, 'Task');
  const request = await client.request(`ServiceRequest/${input.requestId}`, 'ServiceRequest');
  const identifiers = request.identifier as Array<{system?:string;value?:string}> | undefined;
  const taskIdentifiers = task.identifier as Array<{system?:string;value?:string}> | undefined;
  const coding = (request.code as {coding?:Array<{system?:string;code?:string}>} | undefined)?.coding;
  const references = task.basedOn as Array<{reference?:string}> | undefined;
  if (task.id !== input.taskId || request.id !== input.requestId ||
      identifiers?.[0]?.system !== orderSystem || identifiers?.[0]?.value !== input.orderNumber ||
      !Array.isArray(taskIdentifiers) || !taskIdentifiers.some(item => item.system === orderSystem && item.value === input.orderNumber) ||
      (task.for as {reference?:string} | undefined)?.reference !== `Patient/${input.patientId}` ||
      (task.owner as {reference?:string} | undefined)?.reference !== `Practitioner/${input.ownerId}` ||
      (request.subject as {reference?:string} | undefined)?.reference !== `Patient/${input.patientId}` ||
      !Array.isArray(references) || references.length !== 1 || references[0]?.reference !== `ServiceRequest/${input.requestId}` ||
      !Array.isArray(coding) || !coding.some(item => item.system === 'http://loinc.org' && item.code === input.loincCode)) {
    throw new FhirProtocolError('Remote order identity conflicts with expected synthetic order');
  }
  const output = task.output as Array<{valueReference?:{reference?:string}}> | undefined;
  if (output !== undefined && !Array.isArray(output)) throw new FhirProtocolError('Invalid Task output');
  const reports = (output ?? []).map(item => item.valueReference?.reference).filter((ref):ref is string => typeof ref === 'string');
  if (reports.some(ref => !/^DiagnosticReport\/[A-Za-z0-9.-]{1,64}$/.test(ref) || !id(ref.split('/')[1] ?? ''))) throw new FhirProtocolError('Task output is not a local DiagnosticReport reference');
  const state: LabTaskState = task.status === 'requested' ? 'awaiting_lab' :
    task.status === 'accepted' || task.status === 'in-progress' ? 'accepted' :
    task.status === 'rejected' ? 'rejected' :
    task.status === 'completed' && reports.length > 0 ? 'completed' : 'needs_review';
  return {state, reportReferences:reports};
}

/** Explicitly gated: run only after the pinned server passes create-only transaction conformance. */
export async function stageOpenElisTask(client: FhirClient, input: SyntheticLabRequest, options: {conditionalCreateTransactionsVerified: boolean}) {
  validate(input);
  if (!options.conditionalCreateTransactionsVerified) throw new FhirProtocolError('Conditional-create transaction conformance has not been verified');
  const patient = await client.request(`Patient/${input.patientId}`, 'Patient');
  const identifiers = patient.identifier as Array<{system?:string;value?:string;type?:{coding?:Array<{system?:string;code?:string}>}}> | undefined;
  const supportedIdentifier = Array.isArray(identifiers) && identifiers.every(item => /^HF-SYNTH-[A-Za-z0-9.-]{1,64}$/.test(item.value ?? '')) && identifiers.some(item => item.system === input.patientIdentifierSystem && item.value === input.patientIdentifier && (
    ['http://openelis-global.org/pat_nationalId','http://openelis-global.org/pat_stNumber'].includes(item.system ?? '') ||
    item.type?.coding?.some(code => code.system === 'http://openelis-global.org/genIdType' && code.code === 'externalId')
  ));
  if (patient.id !== input.patientId || !supportedIdentifier || !['male','female'].includes(String(patient.gender)) ||
      typeof patient.birthDate !== 'string' || !Array.isArray(patient.name) || !patient.name.length) {
    throw new FhirProtocolError('Patient does not satisfy the synthetic OpenELIS identity profile');
  }
  const result = await client.request('', 'Bundle', {method:'POST',body:buildOpenElisTaskTransaction(input)});
  const entries = result.entry as Array<{response?:{status?:string;location?:string}}> | undefined;
  if (result.type !== 'transaction-response' || !Array.isArray(entries) || entries.length !== 2 ||
      entries.some(entry => !/^201(?: |$)/.test(entry.response?.status ?? ''))) {
    throw new FhirProtocolError('Creation not confirmed; inspect remote Task before any retry');
  }
  const assignedId = (index: number, type: string) => {
    // Require relative receipts to avoid trusting arbitrary upstream origins.
    const match = entries[index]?.response?.location?.match(new RegExp(`^${type}/([A-Za-z0-9.-]{1,64})(?:/_history/[A-Za-z0-9.-]+)?$`));
    if (!match || !id(match[1] ?? '')) throw new FhirProtocolError('Missing creation receipt; reconcile by synthetic order identifier');
    return match[1]!;
  };
  const requestId = assignedId(0, 'ServiceRequest');
  const taskId = assignedId(1, 'Task');
  // Persist these server-assigned IDs with the stable order identifier before proceeding.
  // Even HTTP 201 does not establish that OpenELIS imported or accepted an order.
  return {state:'awaiting_lab' as const, taskId, requestId};
}

/** Recover server-assigned IDs after a lost receipt without submitting another order. */
export async function reconcileOpenElisTask(client: FhirClient, input: SyntheticLabRequest) {
  validate(input);
  const assigned: Record<string, string> = {};
  for (const type of ['ServiceRequest', 'Task']) {
    const result = await client.request(`${type}?identifier=${encodeURIComponent(orderSystem + '|' + input.orderNumber)}`, 'Bundle');
    const entries = result.entry as Array<{resource?: FhirResource}> | undefined;
    const links = result.link as Array<{relation?: string}> | undefined;
    const resource = entries?.[0]?.resource;
    if (result.total !== 1 || !Array.isArray(entries) || entries.length !== 1 || links?.some(link => link.relation === 'next') ||
        resource?.resourceType !== type || !id(String(resource.id ?? ''))) {
      throw new FhirProtocolError('Synthetic order reconciliation requires exactly one matching request and Task');
    }
    assigned[type] = String(resource!.id);
  }
  const correlated = {...input, requestId: assigned.ServiceRequest!, taskId: assigned.Task!};
  return {...await inspectOpenElisTask(client, correlated), requestId: correlated.requestId, taskId: correlated.taskId};
}
