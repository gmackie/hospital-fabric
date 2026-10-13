import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,cpSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform==='win32')throw new Error('Process-group restart smoke requires Linux/macOS');
const temp=mkdtempSync(join(tmpdir(),'hf-type3-smoke-')),project=join(temp,'project');
cpSync(join(root,'apps/type3-worker'),project,{recursive:true,filter:p=>!/(node_modules|\.celld|\.wrangler)(\/|$)/.test(p)});
const key=randomBytes(32).toString('hex');writeFileSync(join(project,'.dev.vars'),`TYPE3_API_KEY=${key}\n`,{mode:0o600});
async function port(){const s=createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r);});const n=s.address().port;await new Promise(r=>s.close(r));return n;}
const n=await port(),base=`http://127.0.0.1:${n}`,celld=process.env.CELLD_BIN;
let child,logs='',dropNext=true,proxyError=null;
const headers={'x-type3-token':key,'content-type':'application/json'};
async function api(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});const value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;}
async function start(){
 const args=celld?['dev',project,'--host','127.0.0.1','--port',String(n),'--no-watch','--logs']:[join(root,'node_modules/wrangler/bin/wrangler.js'),'dev','--config',join(project,'wrangler.jsonc'),'--local','--ip','127.0.0.1','--port',String(n),'--persist-to',join(temp,'d1'),'--inspector-port','0'];
 child=spawn(celld||process.execPath,args,{cwd:root,detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,CI:'1',WRANGLER_SEND_METRICS:'false',CELLD_ESBUILD:join(root,'node_modules/.bin/esbuild'),XDG_CONFIG_HOME:join(temp,'config'),BROWSER:'none'}});
 let error;child.once('error',e=>{error=e;});for(const stream of [child.stdout,child.stderr])stream.on('data',b=>{logs=(logs+b.toString()).slice(-20000);});
 for(let i=0;i<120;i++){if(error)throw error;if(child.exitCode!==null)throw new Error('Runtime exited before readiness');const r=await fetch(base+'/healthz',{signal:AbortSignal.timeout(400)}).catch(()=>null);if(r?.ok){assert.equal((await r.json()).service,'hospital-fabric-type3-research');return;}await delay(500);}
 throw new Error('Runtime did not become ready');
}
async function stop(){
 if(!child)return;const current=child;child=null;
 const rows=execFileSync('ps',['-axo','pid=,ppid='],{encoding:'utf8'}).trim().split('\n').map(l=>l.trim().split(/\s+/).map(Number));
 const owned=new Set([current.pid]);let changed=true;while(changed){changed=false;for(const [pid,ppid] of rows)if(owned.has(ppid)&&!owned.has(pid)){owned.add(pid);changed=true;}}
 for(const pid of [...owned].reverse())try{process.kill(pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}
 try{process.kill(-current.pid,'SIGKILL');}catch(e){if(e.code!=='ESRCH')throw e;}
 for(let i=0;i<50;i++){if(!await fetch(base+'/healthz',{signal:AbortSignal.timeout(200)}).catch(()=>null))return;await delay(100);}
 throw new Error('Runtime remained reachable after stop');
}
const proxy=createServer(async(req,res)=>{
 try{const chunks=[];for await(const c of req)chunks.push(c);const upstream=await fetch(base+req.url,{method:req.method,headers,body:Buffer.concat(chunks),signal:AbortSignal.timeout(10000)});const bytes=Buffer.from(await upstream.arrayBuffer());
 if(dropNext&&req.url.endsWith('/commands')&&upstream.ok){dropNext=false;res.destroy();return;}
 res.writeHead(upstream.status,{'content-type':'application/json'});res.end(bytes);
 }catch(e){proxyError=e;res.destroy();}
});
try{
 await start();await api('/v2/admin/bootstrap',{});await api('/v2/studies',{id:'restart-proof',profile:'emt3-research-v2'});
 await new Promise((r,j)=>{proxy.once('error',j);proxy.listen(0,'127.0.0.1',r);});
 const command={requestId:'lost-response-command',expectedVersion:0,actor:'operator',action:'patient.arrive',args:{patientId:'SIM-RESTART'}};
 const path='/v2/studies/restart-proof/commands';
 await assert.rejects(()=>fetch(`http://127.0.0.1:${proxy.address().port}`+path,{method:'POST',headers,body:JSON.stringify(command),signal:AbortSignal.timeout(10000)}));
 assert.equal(proxyError,null);assert.equal(dropNext,false,'The upstream command must commit before its response is dropped');
 await stop();await start();const restored=await api(path,command);assert.equal(restored.state.version,1);assert.equal(restored.state.patients.length,1);
 const exported=await api('/v2/studies/restart-proof/export');assert.equal(exported.commands.length,1);assert.equal(exported.stateDigest,restored.stateDigest);
 const evidence={runtime:celld?'celld':'workerd',passed:true,processRestart:true,httpResponseDeliberatelyDropped:true,committedCommands:1,finalDigest:restored.stateDigest,physicalWanDisconnected:false,physicalHardwareTested:false,clinicalValidation:false};
 if(process.env.TYPE3_EVIDENCE_PATH)writeFileSync(resolve(process.env.TYPE3_EVIDENCE_PATH),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence,null,2));
}catch(e){console.error(logs.replaceAll(key,'[REDACTED]'));throw e;}
finally{proxy.closeAllConnections();await new Promise(r=>proxy.close(()=>r()));await stop();rmSync(temp,{recursive:true,force:true});}
