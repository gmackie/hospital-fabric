import type { Env } from '../db/types';
import { deploymentProfile } from '../profile';

/**
 * Site-to-cloud link (HF-13 Phase R). The site signs every request with
 * HMAC-SHA256(SITE_LINK_SECRET, `${timestamp}.${nonce}.${body}`); the cloud
 * rejects bad signatures, stale timestamps and replayed nonces.
 */
export const SITE_LINK_HEADERS = { timestamp:'x-hf-link-timestamp', nonce:'x-hf-link-nonce', signature:'x-hf-link-signature' } as const;
export const SITE_LINK_MAX_SKEW_SECONDS = 300;
const LEASE_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2,'0')).join('');

export function siteLinkSecret(env: Env): string | null {
  const secret = env.SITE_LINK_SECRET;
  return secret && encoder.encode(secret).length >= 32 ? secret : null;
}
export function siteId(env: Env): string {
  const id = env.SITE_ID ?? 'local';
  return /^[a-z0-9-]{1,40}$/.test(id) ? id : 'local';
}
/** Only the sending profiles, and only with both a secret and a cloud URL. */
export function siteLinkSendEnabled(env: Env): boolean {
  if (!deploymentProfile(env).siteLinkSend || !siteLinkSecret(env) || !env.SITE_LINK_URL) return false;
  try { return ['https:','http:'].includes(new URL(env.SITE_LINK_URL).protocol); } catch { return false; }
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign','verify']);
}
export async function signLinkRequest(secret: string, timestamp: string, nonce: string, body: string) {
  return hex(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`${timestamp}.${nonce}.${body}`)));
}
/** Constant-time comparison through WebCrypto verify. */
export async function verifyLinkSignature(secret: string, timestamp: string, nonce: string, body: string, signature: string) {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(signature.slice(i*2, i*2+2), 16);
  return crypto.subtle.verify('HMAC', await hmacKey(secret), bytes, encoder.encode(`${timestamp}.${nonce}.${body}`));
}
export async function sha256Hex(text: string) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

async function postSigned(env: Env, path: string, payload: unknown) {
  const secret = siteLinkSecret(env)!;
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now()/1000));
  const nonce = crypto.randomUUID();
  const signature = await signLinkRequest(secret, timestamp, nonce, body);
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
  return fetch(new Request(new URL(path, env.SITE_LINK_URL).href, {
    method:'POST', body, signal,
    headers:{'content-type':'application/json',[SITE_LINK_HEADERS.timestamp]:timestamp,[SITE_LINK_HEADERS.nonce]:nonce,[SITE_LINK_HEADERS.signature]:signature},
  }));
}

export async function referralQueueDepth(env: Env) {
  const row = await env.DB.prepare("SELECT count(*) AS n FROM site_link_referrals WHERE state NOT IN ('delivered','blocked')").first<{n:number}>();
  return row?.n ?? 0;
}

export async function sendHeartbeat(env: Env) {
  const unfinished = await env.DB.prepare("SELECT count(*) AS n FROM outbox WHERE state NOT IN ('delivered','blocked')").first<{n:number}>();
  const response = await postSigned(env, '/site-link/v1/heartbeat', {
    siteId:siteId(env), sentAt:Date.now(), commit:env.HF_COMMIT ?? null,
    unfinishedDeliveries:unfinished?.n ?? 0, referralQueueDepth:await referralQueueDepth(env),
  });
  await response.body?.cancel();
  return { ok:response.ok, status:response.status };
}

/** Create one synthetic referral in the outbox. A repeated requestId returns the same row. */
export async function enqueueSyntheticReferral(env: Env, input: { requestId?: string; reason?: string }) {
  const site = siteId(env);
  const key = `${site}:referral:${input.requestId ?? crypto.randomUUID()}`;
  const existing = await env.DB.prepare('SELECT id,idempotency_key,state FROM site_link_referrals WHERE idempotency_key=?').bind(key).first<{id:string;idempotency_key:string;state:string}>();
  if (existing) return { referralId:existing.id, idempotencyKey:key, state:existing.state, duplicated:true };
  const at = Date.now();
  const id = `ref-${crypto.randomUUID()}`;
  const payload = JSON.stringify({ referralId:id, siteId:site, reason:input.reason ?? 'synthetic-transfer', patientLabel:'SYNTHETIC REFERRAL PATIENT', createdAt:at, synthetic:true });
  const inserted = await env.DB.prepare(`INSERT INTO site_link_referrals(id,idempotency_key,payload_json,payload_hash,state,attempts,available_at,created_at,updated_at)
    VALUES(?,?,?,?,'pending',0,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id`)
    .bind(id,key,payload,await sha256Hex(payload),at,at,at).first<{id:string}>();
  if (!inserted) return enqueueSyntheticReferral(env, input); // Lost a concurrent insert race; read the winner.
  return { referralId:id, idempotencyKey:key, state:'pending', duplicated:false };
}

type Claimed = { id: string; idempotency_key: string; payload_json: string; attempts: number; lease_token: string };
const due = `((state IN ('pending','retry') AND available_at<=?) OR (state='processing' AND lease_until<=?))`;

/** Same discipline as jobs/dispatch.ts: a conditional claim, then every write fenced to the lease. */
async function claim(env: Env): Promise<Claimed | null> {
  const at = Date.now();
  const next = await env.DB.prepare(`SELECT id FROM site_link_referrals WHERE ${due} ORDER BY created_at,rowid LIMIT 1`).bind(at,at).first<{id:string}>();
  if (!next) return null;
  const token = crypto.randomUUID();
  const claimed = await env.DB.prepare(`UPDATE site_link_referrals SET state='processing',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=?
    WHERE id=? AND ${due} RETURNING id,idempotency_key,payload_json,attempts`)
    .bind(token,at+LEASE_MS,at,next.id,at,at).first<Omit<Claimed,'lease_token'>>();
  return claimed ? { ...claimed, lease_token:token } : null;
}

async function settle(env: Env, item: Claimed, state: 'delivered'|'retry'|'blocked', error: string | null) {
  const at = Date.now();
  const retryAt = at + Math.min(60_000, 1000 * 2 ** Math.min(item.attempts, 6));
  const result = await env.DB.prepare(`UPDATE site_link_referrals SET state=?,available_at=?,last_error=?,delivered_at=?,lease_token=NULL,lease_until=NULL,updated_at=?
    WHERE id=? AND lease_token=? AND state='processing'`)
    .bind(state, state==='retry' ? retryAt : at, error, state==='delivered' ? at : null, at, item.id, item.lease_token).run();
  return result.meta.changes > 0;
}

/** Deliver one referral. The cloud stores each idempotency key once, so a retry after a lost ACK is harmless. */
export async function deliverOneReferral(env: Env) {
  const item = await claim(env);
  if (!item) return { ran:false, state:'empty' };
  let response: Response;
  try {
    response = await postSigned(env, '/site-link/v1/referrals', {
      siteId:siteId(env), idempotencyKey:item.idempotency_key, payload:JSON.parse(item.payload_json),
    });
  } catch (error) {
    await settle(env, item, 'retry', error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network');
    return { ran:true, state:'retry', referralId:item.id };
  }
  const body = await response.json().catch(() => null) as { accepted?: boolean; code?: string } | null;
  if (response.ok && body?.accepted === true) {
    const fenced = await settle(env, item, 'delivered', null);
    return { ran:true, state:fenced ? 'delivered' : 'lease_lost', referralId:item.id };
  }
  // The cloud holds a different payload under this key: never overwrite it, stop and surface it.
  const state = response.status === 409 && body?.code === 'referral_conflict' ? 'blocked' : 'retry';
  await settle(env, item, state, `http_${response.status}`);
  return { ran:true, state, referralId:item.id };
}

/** Bounded drain. Stop at the first failure: the cloud is probably unreachable. */
export async function drainReferrals(env: Env, limit = 25) {
  const outcomes: Array<{ran:boolean;state:string;referralId?:string}> = [];
  for (let i = 0; i < limit; i++) {
    const result = await deliverOneReferral(env);
    if (!result.ran) break;
    outcomes.push(result);
    if (result.state !== 'delivered') break;
  }
  return outcomes;
}

/** One cron tick: drain first so the heartbeat reports the post-drain depth. */
export async function runSiteLink(env: Env) {
  const delivered = await drainReferrals(env);
  let heartbeat: { ok: boolean; status: number | null };
  try { heartbeat = await sendHeartbeat(env); } catch { heartbeat = { ok:false, status:null }; }
  return { heartbeat, delivered, referralQueueDepth:await referralQueueDepth(env) };
}
