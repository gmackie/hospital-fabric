import type { Env } from '../db/types';
import type { LaboratoryAdapter } from './contracts';
import { simulatedLisAdapter } from './lis-simulator';
import { AdapterUnavailable } from '../domain/errors';
import { deploymentProfile } from '../profile';

type LabFactory = { simulator: boolean; create(env: Env): LaboratoryAdapter };

/** Products the worker can deliver to, keyed by component_instances.product. */
const LAB_ADAPTERS: Readonly<Record<string, LabFactory>> = {
  'OpenELIS-compatible simulator': { simulator: true, create: simulatedLisAdapter },
  // Real OpenELIS delivery still runs from deploy/real host scripts; it moves
  // here once its connector implements LaboratoryAdapter.
};

/**
 * Resolve the destination named by an operation's target_system. Raised before
 * any remote call, so an unavailable adapter never leaves an ambiguous outcome.
 */
export async function labAdapterFor(env: Env, componentId: string): Promise<LaboratoryAdapter> {
  const row = await env.DB.prepare("SELECT product,enabled FROM component_instances WHERE id=? AND kind='lis'")
    .bind(componentId).first<{product:string;enabled:number}>();
  if (!row) throw new AdapterUnavailable(`No laboratory component ${componentId} is registered`);
  if (row.enabled !== 1) throw new AdapterUnavailable(`Laboratory component ${componentId} is disabled`);
  const factory = Object.hasOwn(LAB_ADAPTERS, row.product) ? LAB_ADAPTERS[row.product] : undefined;
  if (!factory) throw new AdapterUnavailable(`No worker adapter for ${row.product}`);
  const profile = deploymentProfile(env);
  if (!factory.simulator && !profile.realAdapters) throw new AdapterUnavailable(`${row.product} is not permitted in the ${profile.name} profile`);
  return factory.create(env);
}
