import { serve } from './api/router';
import { runDispatchBatch } from './jobs/dispatch';
import { pollResults } from './jobs/results';
import type { Env } from './db/types';

/** One deployable celld/workerd Worker with independent API, dispatch, and result-poll modules. */
export default {
  fetch(request:Request,env:Env) { return serve(request,env); },
  async scheduled(_controller:unknown,env:Env) {
    // Periodic sweep is a safety net: it recovers work after node restarts.
    // Do not depend on in-memory timers in the isolate.
    if (!env.DEMO_API_KEY && env.PUBLIC_DEMO!=='1') return; // This scaffold is not enabled for production workloads.
    try {
      await runDispatchBatch(env,10);
      await pollResults(env,25);
    } catch(error) {
      console.error('Scheduled integration sweep failed', error instanceof Error ? error.name : 'Unknown');
    }
  },
};
