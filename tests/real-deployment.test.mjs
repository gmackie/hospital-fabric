import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const image='example/service@sha256:'+'a'.repeat(64);
const check=services=>spawnSync('python3',['deploy/real/check-compose.py'],{input:JSON.stringify({services}),encoding:'utf8'});
test('resolved deployment checker accepts pinned loopback services',()=>{
 assert.equal(check({app:{image,ports:[{host_ip:'127.0.0.1',published:'8090',target:80}]},db:{image}}).status,0);
});
test('resolved deployment checker rejects mutable images and public/privileged services',()=>{
 for(const service of [{image:'example/service:latest'},{image,ports:[{published:'80',target:80}]},{image,ports:[{host_ip:'0.0.0.0',published:'80',target:80}]},{image,privileged:true},{image,network_mode:'host'}])assert.notEqual(check({app:service}).status,0);
 assert.notEqual(check({}).status,0);
});
