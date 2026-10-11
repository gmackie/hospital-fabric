import type { Env } from '../db/types';
import { ApiError } from '../domain/errors';
import { seedHospital, applyCommand, viewHospital, SimulationError, type Hospital, type Command } from './model';
type Row={token:string;version:number;state_json:string};
const json=(data:unknown,status=200,headers={})=>Response.json(data,{status,headers:{'cache-control':'no-store',...headers}});
export async function hospitalApi(request:Request,env:Env) {
  const url=new URL(request.url);
  if(!['GET','POST'].includes(request.method))throw new ApiError(405,'method_not_allowed','Use GET or POST');
  if(request.method==='POST'&&request.headers.get('origin')!==url.origin)throw new ApiError(403,'origin_required','Use the simulation on this site');
  if(env.DEMO_RATE_LIMITER&&!(await env.DEMO_RATE_LIMITER.limit({key:request.headers.get('cf-connecting-ip')??'local'})).success)throw new ApiError(429,'rate_limited','Wait a minute before continuing.');
  const token=request.headers.get('cookie')?.match(/(?:^|;\s*)hospital_sim=([a-f0-9]{64})(?:;|$)/)?.[1];
  let row=token?await env.DB.prepare('SELECT token,version,state_json FROM hospital_simulations WHERE token=? AND expires_at>?').bind(token,Date.now()).first<Row>():null;
  if(url.pathname==='/hospital/api/session'&&request.method==='POST') {
    if(!row) {
      const slot=await env.DB.prepare('UPDATE public_demo_budget SET used=used+1 WHERE id=1 AND used<5000 RETURNING used').first();
      if(!slot)throw new ApiError(503,'demo_full','The public demo has reached its storage budget.');
      row={token:crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),version:0,state_json:JSON.stringify(seedHospital())};
      await env.DB.prepare('INSERT INTO hospital_simulations(token,version,state_json,created_at,expires_at) VALUES(?,0,?,?,?)').bind(row.token,row.state_json,Date.now(),Date.now()+86400000).run();
    }
    return json(viewHospital(JSON.parse(row.state_json),row.version),200,{'set-cookie':`hospital_sim=${row.token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`});
  }
  if(!row)throw new ApiError(401,'session_required','Start a hospital shift first.');
  if(url.pathname==='/hospital/api/state'&&request.method==='GET')return json(viewHospital(JSON.parse(row.state_json),row.version));
  if(url.pathname!=='/hospital/api/commands'||request.method!=='POST')throw new ApiError(404,'not_found','Unknown simulation endpoint');
  if(Number(request.headers.get('content-length')??0)>2048)throw new ApiError(413,'payload_too_large','Command limit is 2 KiB');
  const text=await request.text();if(text.length>2048)throw new ApiError(413,'payload_too_large','Command limit is 2 KiB');
  let c:Command;
  try{c=JSON.parse(text);}catch{throw new ApiError(400,'invalid_command','Expected a JSON command');}
  if(!c||typeof c!=='object'||!Number.isInteger(c.version)||c.version<0||typeof c.requestId!=='string'||! /^[a-zA-Z0-9-]{8,80}$/.test(c.requestId)||!['advance','arrival','wan','clock','resupply'].includes(c.action)||Object.keys(c).some(k=>!['version','requestId','action','patientId'].includes(k))||(c.action==='advance'?typeof c.patientId!=='string'||!/^SIM-\d{3}$/.test(c.patientId):c.patientId!==undefined))throw new ApiError(400,'invalid_command','Choose a valid simulation action');
  const s:Hospital=JSON.parse(row.state_json);
  // Replays return current state even when their original expected version is old.
  let next:Hospital;
  try{next=applyCommand(s,c);}catch(e){if(e instanceof SimulationError)throw new ApiError(e.status,e.code,e.message);throw e;}
  if(s.receipts.some(r=>r.id===c.requestId))return json(viewHospital(s,row.version));
  if(row.version!==c.version)throw new ApiError(409,'stale_version','Another action changed the hospital. Refresh before continuing.');
  const updated=await env.DB.prepare('UPDATE hospital_simulations SET state_json=?,version=version+1 WHERE token=? AND version=? RETURNING version').bind(JSON.stringify(next),row.token,c.version).first<{version:number}>();
  if(!updated)throw new ApiError(409,'stale_version','Another action changed the hospital. Refresh before continuing.');
  return json(viewHospital(next,updated.version));
}
