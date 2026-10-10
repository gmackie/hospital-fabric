/** Deliberately narrow D1 interface supported by both workerd and celld. */
export type D1Value = string | number | null | boolean | ArrayBuffer | Uint8Array;
export interface D1Result<T> {
  results: T[];
  success: boolean;
  meta: { changes: number; [key: string]: unknown };
}
export interface D1Statement {
  bind(...values: D1Value[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(sql: string): D1Statement;
  batch<T = Record<string, unknown>>(statements: D1Statement[]): Promise<D1Result<T>[]>;
  exec(sql: string): Promise<unknown>;
}
export interface Env {
  DB: D1Database;
  LIS_DB: D1Database;
  PUBLIC_DEMO?: string;
  DEMO_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
  DEMO_API_KEY?: string;
  ALLOW_DEV_BOOTSTRAP?: string;
}
