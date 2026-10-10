/** Server-side FHIR R4 transport. Never expose URLs or authorization to browser callers. */
export type FhirResource = { resourceType: string; id?: string; [key: string]: unknown };
export class FhirProtocolError extends Error {
  constructor(message: string) { super(message); this.name = 'FhirProtocolError'; }
}
export type FhirClientConfig = {
  baseUrl: string;
  authorization?: string;
  /** Explicit container-network host allowlist; never derive this from an HTTP request. */
  privateHttpHosts?: readonly string[];
  fetch?: typeof fetch;
};
export class FhirClient {
  private readonly base: URL;
  private readonly config: FhirClientConfig;
  constructor(config: FhirClientConfig) {
    this.config = config;
    this.base = new URL(config.baseUrl.replace(/\/$/, '') + '/');
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(this.base.hostname);
    const permittedHttp = local || config.privateHttpHosts?.includes(this.base.hostname);
    if (this.base.username || this.base.password || this.base.search || this.base.hash ||
        (this.base.protocol !== 'https:' && !(this.base.protocol === 'http:' && permittedHttp))) {
      throw new FhirProtocolError('FHIR URL must use HTTPS or an explicitly private host, without embedded credentials');
    }
  }
  async request(path: string, resourceType: string, init: {method?: string; body?: FhirResource} = {}): Promise<FhirResource> {
    // Refuse absolute URLs, traversals and encoded URL controls: no credential forwarding/SSRF via references.
    if (!/^[A-Za-z][A-Za-z0-9]*(?:\/[A-Za-z0-9.-]+)?(?:\?[^#]*)?$/.test(path) && path !== '') {
      throw new FhirProtocolError('Invalid relative FHIR path');
    }
    const target = new URL(path, this.base);
    if (target.origin !== this.base.origin || !target.pathname.startsWith(this.base.pathname)) throw new FhirProtocolError('FHIR path escaped configured base');
    const headers: Record<string,string> = {Accept: 'application/fhir+json'};
    if (this.config.authorization) headers.Authorization = this.config.authorization;
    if (init.body) headers['Content-Type'] = 'application/fhir+json';
    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)(target, {
        method: init.method ?? 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined,
        redirect: 'error', signal: AbortSignal.timeout(10_000),
      });
    } catch { throw new FhirProtocolError('FHIR request outcome unavailable; reconcile before retrying any write'); }
    if (!response.ok) throw new FhirProtocolError(`FHIR endpoint returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/fhir+json' && contentType !== 'application/json') throw new FhirProtocolError('FHIR endpoint did not return JSON');
    const reader = response.body?.getReader();
    if (!reader) throw new FhirProtocolError('FHIR endpoint returned an empty body');
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 1_048_576) { await reader.cancel(); throw new FhirProtocolError('FHIR response exceeded size limit'); }
        chunks.push(chunk.value);
      }
    } catch (error) {
      if (error instanceof FhirProtocolError) throw error;
      throw new FhirProtocolError('FHIR response unavailable; reconcile before retrying any write');
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let result: FhirResource;
    try { result = JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new FhirProtocolError('FHIR endpoint returned invalid JSON'); }
    if (!result || result.resourceType !== resourceType) throw new FhirProtocolError(`Expected FHIR ${resourceType}`);
    return result;
  }
  async capabilities() {
    const metadata = await this.request('metadata', 'CapabilityStatement');
    if (metadata.fhirVersion !== '4.0.1') throw new FhirProtocolError('This integration requires FHIR R4 4.0.1');
    return metadata;
  }
}
