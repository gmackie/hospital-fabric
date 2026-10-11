import type { Env } from '../db/types';
import { ApiError } from '../domain/errors';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
/** Fixed synthetic proof projection. No clinical payloads or remote-control commands. */
export async function realDemo(request:Request,env:Env) {
 if(request.method==='GET'&&new URL(request.url).pathname==='/demo/api/real') {
  if(env.DEMO_RATE_LIMITER&&!(await env.DEMO_RATE_LIMITER.limit({key:request.headers.get('cf-connecting-ip')??'local'})).success)throw new ApiError(429,'rate_limited','Please wait a minute');
  const row=await env.DB.prepare('SELECT verified_at,received_at,value FROM real_demo_evidence WHERE id=1').first<{verified_at:string;received_at:number;value:number}>();
  return json({syntheticOnly:true,available:!!row,fresh:!!row&&Date.now()-row.received_at<300_000,verifiedAt:row?.verified_at??null,workflow:row?'registered → accepted → accessioned → validated → returned':null,result:row?{test:'Hemoglobin',value:row.value,unit:'g/dL'}:null,systems:['OpenMRS 3.7.1','OpenELIS 3.2.3.0']});
 }
 if(request.method!=='POST')throw new ApiError(405,'method_not_allowed','Use POST');
 if(!env.REAL_DEMO_BRIDGE_TOKEN||env.REAL_DEMO_BRIDGE_TOKEN.length<32)throw new ApiError(503,'unconfigured','Bridge unavailable');
 if(request.headers.get('authorization')!=='Bearer '+env.REAL_DEMO_BRIDGE_TOKEN)throw new ApiError(401,'unauthorized','Bridge authentication required');
 if(Number(request.headers.get('content-length')??0)>512)throw new ApiError(413,'payload_too_large','Projection limit exceeded');
 const text=await request.text();if(text.length>512)throw new ApiError(413,'payload_too_large','Projection limit exceeded');
 let body:Record<string,unknown>;try{body=JSON.parse(text);}catch{throw new ApiError(400,'invalid_json','Invalid projection');}
 const now=Date.now();
 if(!body||typeof body!=='object'||Object.keys(body).sort().join(',')!=='value,verifiedAt'||body.value!==13.2||typeof body.verifiedAt!=='string'||!Number.isFinite(Date.parse(body.verifiedAt))||Math.abs(now-Date.parse(body.verifiedAt))>120_000)throw new ApiError(400,'invalid_projection','Only the fixed recently verified synthetic projection is accepted');
 await env.DB.prepare('INSERT INTO real_demo_evidence(id,verified_at,received_at,value) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET verified_at=excluded.verified_at,received_at=excluded.received_at,value=excluded.value').bind(body.verifiedAt,now,body.value).run();
 return json({stored:true});
}
