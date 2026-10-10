import { Schema, SchemaParser } from 'effect';

/** Only synthetic demo inputs exist in this milestone. Never send real PHI. */
export const PatientInputSchema = Schema.Struct({
  label: Schema.String,
});
export const LabOrderInputSchema = Schema.Struct({
  patientId: Schema.String,
  testCode: Schema.Literals(['CBC', 'BMP', 'GLUCOSE']),
  requestId: Schema.String,
});
export const ReleaseResultSchema = Schema.Struct({
  resultText: Schema.String,
  unitCode: Schema.String,
});

export type PatientInput = { label: string };
export type LabOrderInput = {
  patientId: string;
  testCode: 'CBC' | 'BMP' | 'GLUCOSE';
  requestId: string;
};
export type ReleaseResultInput = { resultText: string; unitCode: string };

export async function decodePatient(input: unknown): Promise<PatientInput> {
  const data = await SchemaParser.decodeUnknownPromise(PatientInputSchema)(input);
  if (!data.label.trim() || data.label.length > 80) throw new Error('label must have 1–80 characters');
  return data;
}
export async function decodeOrder(input: unknown): Promise<LabOrderInput> {
  const data = await SchemaParser.decodeUnknownPromise(LabOrderInputSchema)(input);
  if (data.patientId.length > 100 || !data.patientId.trim() ||
      !/^[a-zA-Z0-9_.:-]{8,100}$/.test(data.requestId)) {
    throw new Error('Invalid patientId/requestId');
  }
  return data;
}
export async function decodeRelease(input: unknown): Promise<ReleaseResultInput> {
  const data = await SchemaParser.decodeUnknownPromise(ReleaseResultSchema)(input);
  if (!data.resultText.trim() || data.resultText.length > 120 ||
      !data.unitCode.trim() || data.unitCode.length > 40) {
    throw new Error('Invalid synthetic result');
  }
  return data;
}
