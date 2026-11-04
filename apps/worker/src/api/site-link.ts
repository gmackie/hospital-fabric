import type { Env } from '../db/types';
import type { DeploymentProfile } from '../profile';
import { ApiError } from '../domain/errors';
import {
  SITE_LINK_HEADERS, SITE_LINK_MAX_SKEW_SECONDS, enqueueSyntheticReferral, referralQueueDepth, runSiteLink,
  sha256Hex, siteLinkSecret, siteLinkSendEnabled, verifyLinkSignature,
} from '../jobs/site-link';

/** A site is online while its last verified heartbeat is younger than this. */
export const SITE_ONLINE_WINDOW_MS = 180_000;
const REFERRAL_REASONS = ['synthetic-transfer','synthetic-specialist-review','synthetic-imaging'];
const json = (body: unknown,status=200) => Response.json(body,{status,headers:{'cache-control':'no-store'}});
const notFound = () => json({code:'not_found'},404);

async function readLimited(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > 8_192) throw new ApiError(413,'payload_too_large','Body limit is 8 KiB');
  const text = await request.text();
  if (text.length > 8_192) throw new ApiError(413,'payload_too_large','Body limit is 8 KiB');
  return text;
}
const isCount = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1e9;
const isSiteId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v);

/** Authenticate a signed site request and consume its nonce. Returns the parsed body. */
async function verifiedBody(request: Request, env: Env, secret: string): Promise<Record<string, unknown>> {
  const body = await readLimited(request);
  const timestamp = request.headers.get(SITE_LINK_HEADERS.timestamp) ?? '';
  const nonce = request.headers.get(SITE_LINK_HEADERS.nonce) ?? '';
  const signature = request.headers.get(SITE_LINK_HEADERS.signature) ?? '';
  if (!/^\d{1,12}$/.test(timestamp) || !/^[A-Za-z0-9-]{16,64}$/.test(nonce) ||
    !(await verifyLinkSignature(secret, timestamp, nonce, body, signature)))
    throw new ApiError(401,'bad_signature','Signature verification failed');
  const now = Date.now();
  if (Math.abs(now/1000 - Number(timestamp)) > SITE_LINK_MAX_SKEW_SECONDS) throw new ApiError(401,'stale_timestamp','Timestamp outside the accepted window');
  // Nonces older than twice the window can no longer pass the timestamp check.
  await env.DB.prepare('DELETE FROM site_link_nonces WHERE received_at<?').bind(now - 2_000*SITE_LINK_MAX_SKEW_SECONDS).run();
  const fresh = await env.DB.prepare('INSERT INTO site_link_nonces(nonce,received_at) VALUES(?,?) ON CONFLICT(nonce) DO NOTHING RETURNING nonce')
    .bind(nonce,now).first<{nonce:string}>();
  if (!fresh) throw new ApiError(401,'replayed_nonce','Nonce already used');
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new ApiError(400,'invalid_input','Expected a JSON object');
}

async function receiveHeartbeat(request: Request, env: Env, secret: string) {
  const b = await verifiedBody(request, env, secret);
  const commit = b.commit ?? null, sentAt = b.sentAt;
  if (!isSiteId(b.siteId) || typeof sentAt !== 'number' || !Number.isInteger(sentAt) || sentAt <= 0 || sentAt >= 1e14 || !isCount(b.unfinishedDeliveries) || !isCount(b.referralQueueDepth) ||
    !(commit === null || (typeof commit === 'string' && /^[0-9a-f]{7,40}$/.test(commit))))
    throw new ApiError(400,'invalid_input','Invalid heartbeat');
  await env.DB.prepare(`INSERT INTO site_link_heartbeats(site_id,received_at,sent_at,commit_sha,unfinished_deliveries,referral_queue_depth)
    VALUES(?,?,?,?,?,?) ON CONFLICT(site_id) DO UPDATE SET received_at=excluded.received_at,sent_at=excluded.sent_at,
    commit_sha=excluded.commit_sha,unfinished_deliveries=excluded.unfinished_deliveries,referral_queue_depth=excluded.referral_queue_depth`)
    .bind(b.siteId,Date.now(),sentAt,commit as string | null,b.unfinishedDeliveries,b.referralQueueDepth).run();
  return json({accepted:true});
}

async function receiveReferral(request: Request, env: Env, secret: string) {
  const b = await verifiedBody(request, env, secret);
  const payload = b.payload as Record<string, unknown> | undefined;
  const key = b.idempotencyKey;
  if (!isSiteId(b.siteId) || typeof key !== 'string' || !/^[A-Za-z0-9:._-]{1,200}$/.test(key) || !key.startsWith(`${b.siteId}:`) ||
    !payload || typeof payload !== 'object' || Array.isArray(payload) || payload.synthetic !== true)
    throw new ApiError(400,'invalid_input','Invalid synthetic referral');
  const payloadJson = JSON.stringify(payload);
  const hash = await sha256Hex(payloadJson);
  // The primary key on idempotency_key is what makes delivery exactly once.
  const stored = await env.DB.prepare(`INSERT INTO site_link_inbound_referrals(idempotency_key,site_id,payload_hash,payload_json,received_at)
    VALUES(?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING RETURNING idempotency_key`)
    .bind(key,b.siteId,hash,payloadJson,Date.now()).first<{idempotency_key:string}>();
  if (stored) return json({accepted:true,duplicate:false},201);
  const prior = await env.DB.prepare('SELECT site_id,payload_hash FROM site_link_inbound_referrals WHERE idempotency_key=?').bind(key).first<{site_id:string;payload_hash:string}>();
  if (prior?.site_id !== b.siteId || prior.payload_hash !== hash) throw new ApiError(409,'referral_conflict','Idempotency key already holds a different referral');
  return json({accepted:true,duplicate:true});
}

type SiteRow = { site_id: string; received_at: number; commit_sha: string | null; unfinished_deliveries: number;
  referral_queue_depth: number; referrals_received: number; last_referral_at: number | null };
export async function siteLinkStatus(env: Env) {
  const now = Date.now();
  const {results} = await env.DB.prepare(`SELECT h.site_id,h.received_at,h.commit_sha,h.unfinished_deliveries,h.referral_queue_depth,
    (SELECT count(*) FROM site_link_inbound_referrals r WHERE r.site_id=h.site_id) AS referrals_received,
    (SELECT max(r.received_at) FROM site_link_inbound_referrals r WHERE r.site_id=h.site_id) AS last_referral_at
    FROM site_link_heartbeats h ORDER BY h.site_id LIMIT 20`).all<SiteRow>();
  return {
    syntheticOnly:true, generatedAt:new Date(now).toISOString(), onlineWindowSeconds:SITE_ONLINE_WINDOW_MS/1000,
    sites:results.map(r => ({
      siteId:r.site_id, online:now - r.received_at < SITE_ONLINE_WINDOW_MS,
      lastHeartbeatAt:new Date(r.received_at).toISOString(), lastHeartbeatAgeSeconds:Math.max(0,Math.round((now - r.received_at)/1000)),
      commit:r.commit_sha, reportedReferralQueueDepth:r.referral_queue_depth, reportedUnfinishedDeliveries:r.unfinished_deliveries,
      referralsReceived:r.referrals_received, lastReferralAt:r.last_referral_at === null ? null : new Date(r.last_referral_at).toISOString(),
    })),
  };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
async function statusPage(env: Env) {
  const status = await siteLinkStatus(env);
  const rows = status.sites.map(s => `<tr><td>${escapeHtml(s.siteId)}</td><td class="${s.online?'on':'off'}">${s.online?'online':'offline'}</td>
<td>${escapeHtml(s.lastHeartbeatAt)} (${s.lastHeartbeatAgeSeconds}s ago)</td><td>${s.reportedReferralQueueDepth}</td><td>${s.referralsReceived}</td><td>${escapeHtml(s.commit?.slice(0,12) ?? '—')}</td></tr>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="30">
<title>Hospital Fabric · Site link</title><style>body{font-family:ui-sans-serif,system-ui,sans-serif;color:#19332d;background:#f3f5ef;margin:0;padding:40px 5%}table{border-collapse:collapse;background:#fff;width:100%}th,td{border:1px solid #dbe3d6;padding:10px;text-align:left;font-size:14px}.on{color:#2f7a4a;font-weight:700}.off{color:#a13725;font-weight:700}p{color:#607066}</style></head>
<body><h1>Site-to-cloud link</h1><p>Synthetic data only. A site is online while its last signed heartbeat is under ${status.onlineWindowSeconds} seconds old. Generated ${escapeHtml(status.generatedAt)}; refreshes every 30 seconds. JSON: <a href="/site-link/v1/status">/site-link/v1/status</a></p>
<table><thead><tr><th>Site</th><th>Link</th><th>Last heartbeat</th><th>Reported referral queue</th><th>Referrals received</th><th>Commit</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No site has sent a heartbeat yet.</td></tr>'}</tbody></table></body></html>`;
  return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
    'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}});
}

/** Public, unauthenticated cloud surface under /site-link. Disabled unless the profile receives and the secret is set. */
export async function siteLinkPublic(request: Request, env: Env, profile: DeploymentProfile): Promise<Response> {
  const secret = siteLinkSecret(env);
  if (!profile.siteLinkReceive || !secret) return notFound();
  const path = new URL(request.url).pathname, method = request.method;
  if (method==='POST' && path==='/site-link/v1/heartbeat') return receiveHeartbeat(request, env, secret);
  if (method==='POST' && path==='/site-link/v1/referrals') return receiveReferral(request, env, secret);
  if (method==='GET' && path==='/site-link/v1/status') return json(await siteLinkStatus(env));
  if (method==='GET' && (path==='/site-link' || path==='/site-link/')) return statusPage(env);
  return notFound();
}

/** Authenticated operator surface on the site under /v1/site-link. */
export async function siteLinkOperator(request: Request, env: Env): Promise<Response> {
  if (!siteLinkSendEnabled(env)) throw new ApiError(404,'site_link_disabled','Site link is not configured on this profile');
  const path = new URL(request.url).pathname, method = request.method;
  if (method==='POST' && path==='/v1/site-link/referrals') {
    const text = await readLimited(request);
    let input: Record<string, unknown> = {};
    try { if (text.trim()) input = JSON.parse(text) as Record<string, unknown>; } catch { throw new ApiError(400,'invalid_json','Expected a JSON request body'); }
    const { requestId, reason } = input ?? {};
    if ((requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(requestId))) ||
      (reason !== undefined && (typeof reason !== 'string' || !REFERRAL_REASONS.includes(reason))))
      throw new ApiError(400,'invalid_input',`Optional requestId and reason (${REFERRAL_REASONS.join(', ')})`);
    const created = await enqueueSyntheticReferral(env, { requestId, reason } as { requestId?: string; reason?: string });
    return json(created, created.duplicated ? 200 : 201);
  }
  if (method==='GET' && path==='/v1/site-link/referrals') {
    const {results} = await env.DB.prepare(`SELECT id,idempotency_key,state,attempts,last_error,created_at,delivered_at
      FROM site_link_referrals ORDER BY created_at DESC LIMIT 50`).all();
    return json({referrals:results,referralQueueDepth:await referralQueueDepth(env),syntheticOnly:true});
  }
  if (method==='POST' && path==='/v1/site-link/sync') return json(await runSiteLink(env));
  return json({code:'not_found',message:`No ${method} handler for ${path}`},404);
}
