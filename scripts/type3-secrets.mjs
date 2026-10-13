import {randomBytes} from 'node:crypto';
import {existsSync,writeFileSync} from 'node:fs';
const path=new URL('../apps/type3-worker/.dev.vars',import.meta.url);
if(existsSync(path))console.log('Existing Type 3 local secret retained.');
else{writeFileSync(path,`TYPE3_API_KEY=${randomBytes(32).toString('hex')}\n`,{mode:0o600,flag:'wx'});console.log('Created ignored apps/type3-worker/.dev.vars. Do not commit or share it.');}
