import { PROTOCOL, MODEL_ID, MODEL_VERSION, DIGEST, WARNING, fields, identifier, integer, ResearchError } from './protocol.js';
import { PROFILES, STANDARD_REFERENCES } from './profiles.js';
import { ACTIONS, readiness, evidenceStatus } from './model.js';
import { evaluateProcurement } from './hardware.js';
import { reportBundle, serviceRequest } from './laboratory.js';
import { type Database, bootstrap, createStudy, readStudy, execute, journal, exportStudy } from './storage.js';
import { HTML, JAVASCRIPT } from './ui.js';
export type Env={RESEARCH_DB:Database;ENABLE_TYPE3_RESEARCH?:string;PUBLIC_DEMO?:string;ALLOW_TYPE3_BOOTSTRAP?:string;TYPE3_API_KEY?:string};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function body(request:Request):Promise<unknown> {
  if(!request.body)throw new ResearchError(400,'body_required','JSON required');
  if(!(request.headers.get('content-type')??'').startsWith('application/json'))throw new ResearchError(415,'json_required','Use application/json');
  const reader=request.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>16384){await reader.cancel();throw new ResearchError(413,'body_limit','Body exceeds 16 KiB');}chunks.push(item.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ResearchError(400,'invalid_json','Invalid JSON');}
}
function authenticate(request:Request,env:Env) {
  const key=env.TYPE3_API_KEY;if(!key||key.length<32)throw new ResearchError(503,'unconfigured','Configure a local TYPE3_API_KEY with at least 32 characters');
  const provided=request.headers.get('x-type3-token')??'';let different=provided.length^key.length;
  for(let i=0;i<key.length;i++)different|=key.charCodeAt(i)^(provided.charCodeAt(i)||0);
  if(different)throw new ResearchError(401,'unauthorized','Local research token required');
}
export async function serve(request:Request,env:Env):Promise<Response> {
  try {
    const u=new URL(request.url),path=u.pathname;
    // Hard fail closed: this worker has no public research mode.
    if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||env.PUBLIC_DEMO==='1'||env.ENABLE_TYPE3_RESEARCH!=='1')return json({code:'research_disabled'},403);
    if(request.method==='GET'&&path==='/healthz')return json({service:MODEL_ID,warning:WARNING});
    if(request.method==='GET'&&(path==='/'||path==='/app.js'))return new Response(path==='/'?HTML:JAVASCRIPT,{headers:{'content-type':path==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'referrer-policy':'no-referrer','x-content-type-options':'nosniff'}});
    authenticate(request,env);
    const origin=request.headers.get('origin');if(origin&&origin!==u.origin)throw new ResearchError(403,'cross_origin','Cross-origin research access rejected');
    if(request.method==='GET'&&path==='/v2/protocol')return json({modelId:MODEL_ID,modelVersion:MODEL_VERSION,protocol:PROTOCOL,digestAlgorithm:DIGEST,profiles:PROFILES,actions:ACTIONS,standards:STANDARD_REFERENCES,syntheticOnly:true,clinicalUseAllowed:false,v1Unchanged:true});
    if(request.method==='POST'&&path==='/v2/admin/bootstrap') {if(env.ALLOW_TYPE3_BOOTSTRAP!=='1')throw new ResearchError(403,'bootstrap_disabled','Apply the local migration explicitly');await bootstrap(env.RESEARCH_DB);return json({ready:true,syntheticOnly:true});}
    if(request.method==='POST'&&path==='/v2/studies'){const b=fields(await body(request),['id','profile']);return json(await createStudy(env.RESEARCH_DB,b.id,b.profile),201);}
    if(request.method==='POST'&&path==='/v2/hardware/evaluate')return json(evaluateProcurement(await body(request)));
    const match=/^\/v2\/studies\/([A-Za-z0-9_-]{1,64})(?:\/(commands|journal|export|readiness|validation|lab))?$/.exec(path);
    if(match){const id=identifier(match[1]),part=match[2];
      if(request.method==='POST'&&part==='commands')return json(await execute(env.RESEARCH_DB,id,await body(request)));
      if(request.method==='GET'){
        if(part==='export')return json(await exportStudy(env.RESEARCH_DB,id));
        if(part==='journal'){await readStudy(env.RESEARCH_DB,id);return json(await journal(env.RESEARCH_DB,id,integer(Number(u.searchParams.get('after')??0),0,5000),integer(Number(u.searchParams.get('limit')??100),1,200)));}
        const s=await readStudy(env.RESEARCH_DB,id);
        if(part==='readiness')return json({...readiness(s.state),stateDigest:s.stateDigest});
        if(part==='validation')return json({...evidenceStatus(s.state),stateDigest:s.stateDigest});
        if(part==='lab')return json({syntheticOnly:true,orders:s.state.labs.map(order=>({request:serviceRequest(order),reports:order.reports.map(r=>reportBundle(order,r))}))});
        if(!part)return json(s);
      }
    }
    return json({code:'not_found'},404);
  }catch(e){if(e instanceof ResearchError)return json({code:e.code,message:e.message},e.status);return json({code:'internal_error',message:'Research operation failed; no automatic replay was attempted'},500);}
}
