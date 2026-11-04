import { Effect } from 'effect';
import { serve, type Env } from './api.js';
import { maintenance } from './storage.js';
/** Same standard Workers surface on workerd and celld; no cloud-bound runtime calls. */
export default {
  fetch(request:Request,env:Env):Promise<Response> {
    return Effect.runPromise(Effect.tryPromise({try:()=>serve(request,env),catch:()=>new Error('Type 3 research request failed')}));
  },
  scheduled(event:{scheduledTime:number},env:Env,ctx:{waitUntil(p:Promise<unknown>):void}) {
    if(env.ENABLE_TYPE3_RESEARCH==='1'&&env.PUBLIC_DEMO!=='1')ctx.waitUntil(
      Effect.runPromise(Effect.tryPromise({try:()=>maintenance(env.RESEARCH_DB,new Date(event.scheduledTime).toISOString()),catch:()=>new Error('Research maintenance failed')}))
    );
  },
};
