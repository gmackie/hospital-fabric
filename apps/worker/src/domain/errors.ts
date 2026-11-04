export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export class RemoteOutcomeUnknown extends Error {
  readonly _tag = 'RemoteOutcomeUnknown' as const;
}
export class ReconciliationRequired extends Error {
  readonly _tag = 'ReconciliationRequired' as const;
}
/** The registry cannot supply a destination adapter; nothing was sent. */
export class AdapterUnavailable extends Error {
  readonly _tag = 'AdapterUnavailable' as const;
}
