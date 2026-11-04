import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
const image='example/service@sha256:'+'a'.repeat(64);
const check=services=>spawnSync('python3',['deploy/real/check-compose.py'],{input:JSON.stringify({services}),encoding:'utf8'});
test('resolved deployment checker accepts pinned loopback services',()=>{
 assert.equal(check({app:{image,ports:[{host_ip:'127.0.0.1',published:'8090',target:80}]},db:{image}}).status,0);
});
test('resolved deployment checker rejects mutable images and public/privileged services',()=>{
 for(const service of [{image:'example/service:latest'},{image,ports:[{published:'80',target:80}]},{image,ports:[{host_ip:'0.0.0.0',published:'80',target:80}]},{image,privileged:true},{image,network_mode:'host'}])assert.notEqual(check({app:service}).status,0);
 assert.notEqual(check({}).status,0);
});
test('memory-limit mode requires a hard cap with swap disabled on every service',()=>{
 const strict=services=>spawnSync('python3',['deploy/real/check-compose.py','--require-memory-limits'],{input:JSON.stringify({services}),encoding:'utf8'});
 const ok=strict({app:{image,mem_limit:'134217728',memswap_limit:134217728}});
 assert.equal(ok.status,0);
 assert.match(ok.stdout,/total 128 MiB/);
 for(const service of [{image},{image,mem_limit:'134217728'},{image,mem_limit:'134217728',memswap_limit:'268435456'}])assert.notEqual(strict({app:service}).status,0);
 assert.equal(check({app:{image}}).status,0);
});
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const mebibytes=value=>{const [,n,unit]=/^(\d+)([mg])$/.exec(value);return Number(n)*(unit==='g'?1024:1);};
const overlay=text=>{
 const services={};let current;let inServices=false;
 for(const line of text.split('\n')){
  if(/^\S/.test(line)){inServices=line.startsWith('services:');current=undefined;continue;}
  const name=inServices&&/^  ([\w.-]+):\s*$/.exec(line);
  if(name){current=services[name[1]]={};continue;}
  const field=current&&/^    (mem_limit|memswap_limit): (\S+)$/.exec(line);
  if(field)current[field[1]]=field[2];
 }
 return services;
};
test('labnuc overlays cap every product service within the shared-host budget',()=>{
 const expected={openmrs:['gateway','frontend','backend','db'],openelis:['certs','db.openelis.org','oe.openelis.org','fhir.openelis.org','frontend.openelis.org','proxy','source-db','hf-source-fhir']};
 let total=0;
 for(const [product,names] of Object.entries(expected)){
  const text=read(`deploy/real/labnuc/${product}.host.yml`);
  const services=overlay(text);
  assert.deepEqual(Object.keys(services).sort(),[...names].sort());
  for(const [name,service] of Object.entries(services)){
   assert.ok(service.mem_limit,`${product}/${name} has no mem_limit`);
   assert.equal(service.memswap_limit,service.mem_limit,`${product}/${name} may swap`);
   total+=mebibytes(service.mem_limit);
  }
  for(const port of text.matchAll(/"(\d+\.\d+\.\d+\.\d+):\d+:\d+"/g))assert.equal(port[1],'127.0.0.1');
  assert.doesNotMatch(text,/master-apps/);
  for(const path of text.matchAll(/(?:device: |- )(\/[^\s:]+)/g))assert.match(path[1],/^\/(var\/lib\/hospital-fabric\/products|etc\/hospital-fabric\/products)\//);
 }
 // labnuc has ~15 GB available and is shared; keep the stack's hard ceiling at 10 GiB.
 assert.ok(total<=10*1024,`labnuc memory limits total ${total} MiB`);
});
test('labnuc reuses the hetzner-master image pins and shared scripts',()=>{
 assert.deepEqual(JSON.parse(read('deploy/real/labnuc/images.lock.json')),JSON.parse(read('deploy/real/hetzner-master/images.lock.json')));
 const env=Object.fromEntries(read('deploy/real/labnuc/host.env').split('\n').filter(line=>/^[A-Z_]+=/.test(line)).map(line=>line.split('=')));
 assert.deepEqual(env,{HF_HOST:'labnuc',HF_BASE:'/var/lib/hospital-fabric/products',HF_PRIVATE:'/etc/hospital-fabric/products',HF_REQUIRE_MEMORY_LIMITS:'1'});
 const stack=read('deploy/real/labnuc/stack.service');
 assert.match(stack,new RegExp(`EnvironmentFile=${env.HF_BASE}/release/deploy/real/labnuc/host.env`));
 assert.match(stack,new RegExp(`ExecStart=/bin/bash ${env.HF_BASE}/release/deploy/real/hetzner-master/start.sh`));
 assert.match(stack,/Restart=on-failure/);
 assert.match(read('deploy/real/labnuc/podman-api.service'),new RegExp(`--root=${env.HF_BASE}/containers `));
 // Unset profile variables keep the hetzner-master paths.
 assert.match(read('deploy/real/hetzner-master/compose.sh'),/base=\$\{HF_BASE:-\/mnt\/master-apps\/hospital-fabric\}/);
 for(const script of ['probe.mjs','conformance.mjs','conditional-conformance.mjs','adapter-conformance.mjs'])assert.match(read('deploy/real/hetzner-master/'+script),/process\.env\.HF_BASE\?\?'\/mnt\/master-apps\/hospital-fabric'/);
 // Only the authenticated product UIs go on the tailnet; the HAPI stores stay on loopback.
 const serves=[...read('deploy/real/labnuc/tailnet.sh').matchAll(/tailscale serve --bg --https=(\d+) (\S+)/g)].map(match=>[match[1],match[2]]);
 assert.deepEqual(serves,[['18090','http://127.0.0.1:18090'],['18443','http://127.0.0.1:18444']]);
});
