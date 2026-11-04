import type { Env } from './db/types';
import { ApiError } from './domain/errors';

/**
 * One bundle, three runtime roles. The role comes from configuration
 * (HF_PROFILE), never from the request hostname.
 *  - local: developer workstation (wrangler dev / celld dev)
 *  - site:  a hospital's celld fleet beside the on-site products
 *  - cloud: the public Cloudflare tier; simulators only
 */
export type DeploymentProfileName = 'local' | 'site' | 'cloud';
export interface DeploymentProfile {
  readonly name: DeploymentProfileName;
  /** Visitor-session walkthrough under /demo/api and the hospital page at /. */
  readonly publicDemo: boolean;
  /** Operator console assets at /. */
  readonly operatorConsole: boolean;
  /** Research sizing for the shift simulation. */
  readonly researchProfiles: boolean;
  /** Adapters for real on-site products may be resolved from the registry. */
  readonly realAdapters: boolean;
  /** Sends signed heartbeats and queued referrals to SITE_LINK_URL. */
  readonly siteLinkSend: boolean;
  /** Accepts signed site traffic and serves the public link status. */
  readonly siteLinkReceive: boolean;
}

const PROFILES: Readonly<Record<DeploymentProfileName, DeploymentProfile>> = {
  local: { name:'local', publicDemo:false, operatorConsole:true, researchProfiles:true, realAdapters:false, siteLinkSend:true, siteLinkReceive:true },
  site: { name:'site', publicDemo:false, operatorConsole:true, researchProfiles:false, realAdapters:true, siteLinkSend:true, siteLinkReceive:false },
  cloud: { name:'cloud', publicDemo:true, operatorConsole:false, researchProfiles:false, realAdapters:false, siteLinkSend:false, siteLinkReceive:true },
};

export function deploymentProfile(env: Env): DeploymentProfile {
  const raw = env.HF_PROFILE;
  // PUBLIC_DEMO=1 predates profiles; keep it meaning cloud for older configs.
  if (raw === undefined || raw === '') return env.PUBLIC_DEMO === '1' ? PROFILES.cloud : PROFILES.local;
  if (!Object.hasOwn(PROFILES, raw)) throw new ApiError(503,'misconfigured','HF_PROFILE must be local, site or cloud');
  const profile = PROFILES[raw as DeploymentProfileName];
  // Fail closed rather than expose public visitor endpoints on a site fleet.
  if (env.PUBLIC_DEMO === '1' && !profile.publicDemo) throw new ApiError(503,'misconfigured',`PUBLIC_DEMO conflicts with HF_PROFILE=${raw}`);
  return profile;
}
