/** Versioned synthetic research contract. Never changes the v1 hospital/kybernos contract. */
export const MODEL_ID = 'hospital-fabric-type3-research';
export const MODEL_VERSION = 2;
export const PROTOCOL = 'hospital-fabric-type3-commands/v2';
export const DIGEST = 'sha256-canonical-json/v1';
export const WARNING = 'Synthetic research only. No clinical use, device control, or WHO classification.';
export class ResearchError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message); this.name = 'ResearchError';
  }
}
export function requireThat(value: unknown, code: string, message = code): asserts value {
  if (!value) throw new ResearchError(409, code, message);
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ResearchError(400, 'invalid_object', 'Expected an object');
  return value as Record<string, unknown>;
}
export function fields(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  const o = record(value);
  if (Object.keys(o).some(k => !required.includes(k) && !optional.includes(k)) || required.some(k => !Object.hasOwn(o, k))) {
    throw new ResearchError(400, 'invalid_fields', `Expected ${required.join(', ')}`);
  }
  return o;
}
export function text(value: unknown, max = 80): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\u0000-\u001f]/.test(value)) throw new ResearchError(400, 'invalid_text', 'Invalid text');
  return value;
}
export function identifier(value: unknown): string {
  const s = text(value, 64);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(s)) throw new ResearchError(400, 'invalid_id', 'Invalid identifier');
  return s;
}
export function syntheticId(value: unknown): string {
  const s = identifier(value);
  if (!/^SIM-[A-Z0-9_-]+$/.test(s)) throw new ResearchError(400, 'synthetic_id_required', 'Use a SIM- identifier');
  return s;
}
export function integer(value: unknown, lo = 0, hi = 1000): number {
  if (!Number.isSafeInteger(value) || (value as number) < lo || (value as number) > hi) throw new ResearchError(400, 'invalid_integer', `Expected integer ${lo}..${hi}`);
  return value as number;
}
export function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new ResearchError(400, 'invalid_choice', `Expected ${values.join(', ')}`);
  return value as T;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new ResearchError(400, 'noncanonical_number', 'Use safe integers or decimal strings');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  throw new ResearchError(400, 'noncanonical_value', 'Unsupported canonical value');
}
export async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
}
