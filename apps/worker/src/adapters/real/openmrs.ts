import { FhirClient, FhirProtocolError, type FhirResource } from './fhir-client';

/** Read an exact synthetic identity. No fuzzy matching, patient creation or merge. */
export async function readSyntheticOpenMrsPatient(client: FhirClient, identifierSystem: string, identifier: string): Promise<FhirResource | null> {
  if (!identifier.startsWith('HF-SYNTH-') || !identifierSystem || identifierSystem.includes('|') || identifier.includes('|')) {
    throw new FhirProtocolError('A configured identifier system and HF-SYNTH- identifier are required');
  }
  const params = new URLSearchParams({identifier: `${identifierSystem}|${identifier}`, _count: '2'});
  const bundle = await client.request(`Patient?${params}`, 'Bundle');
  const entries = bundle.entry as Array<{resource?: FhirResource}> | undefined;
  if (entries !== undefined && !Array.isArray(entries)) throw new FhirProtocolError('Invalid patient search entries');
  const patients = (entries ?? []).map(entry => entry.resource);
  if (patients.length === 0 && (bundle.total === 0 || bundle.total === undefined)) return null;
  const links = bundle.link as Array<{relation?: string}> | undefined;
  if (patients.length !== 1 || (typeof bundle.total === 'number' && bundle.total > 1) || links?.some(link => link.relation === 'next')) {
    throw new FhirProtocolError('Patient identity is ambiguous');
  }
  const patient = patients[0];
  const identifiers = patient?.identifier as Array<{system?:string; value?:string}> | undefined;
  if (patient?.resourceType !== 'Patient' || !patient.id || !Array.isArray(identifiers) ||
      !identifiers.some(item => item.system === identifierSystem && item.value === identifier)) {
    throw new FhirProtocolError('Patient search did not return the exact identifier');
  }
  return patient;
}
