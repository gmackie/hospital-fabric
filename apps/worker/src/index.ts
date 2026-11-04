import { serve } from './api/router';
import { runDispatchBatch } from './jobs/dispatch';
import { pollResults } from './jobs/results';
import type { Env } from './db/types';
import { deploymentProfile } from './profile';
import { runSiteLink, siteLinkSendEnabled } from './jobs/site-link';

/** One deployable celld/workerd Worker with independent API, dispatch, and result-poll modules. */
export default {
  fetch(request:Request,env:Env) { return serve(request,env); },
  async scheduled(_controller:unknown,env:Env) {
    // Periodic sweep is a safety net: it recovers work after node restarts.
    // Do not depend on in-memory timers in the isolate.
    try {
      // Independent of the dispatch sweep: a WAN outage must not stall local delivery.
      if (siteLinkSendEnabled(env)) await runSiteLink(env);
    } catch(error) {
      console.error('Scheduled site link sweep failed', error instanceof Error ? error.name : 'Unknown');
    }
    try {
      if (!env.DEMO_API_KEY && !deploymentProfile(env).publicDemo) return; // This scaffold is not enabled for production workloads.
      await runDispatchBatch(env,10);
      await pollResults(env,25);
    } catch(error) {
      console.error('Scheduled integration sweep failed', error instanceof Error ? error.name : 'Unknown');
    }
  },
};
