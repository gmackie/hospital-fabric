#!/usr/bin/env python3
"""Verify/export the v2 research contract; optional live replay to a NEW local study.
Does not claim to implement the clinical/simulation transition engine in Python.
"""
import argparse, hashlib, json, os, urllib.request, urllib.parse

def canonical(value):
    if value is None or isinstance(value,(bool,str)): return json.dumps(value,ensure_ascii=False,separators=(',',':'))
    if isinstance(value,int) and abs(value)<=9007199254740991: return str(value)
    if isinstance(value,list): return '['+','.join(map(canonical,value))+']'
    if isinstance(value,dict): return '{'+','.join(canonical(k)+':'+canonical(value[k]) for k in sorted(value))+'}'
    raise ValueError('Noncanonical value; decimal measurements must use strings')

def digest(value): return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()

def main():
    p=argparse.ArgumentParser();p.add_argument('export');p.add_argument('--url');p.add_argument('--study',default='type3-replay');a=p.parse_args()
    with open(a.export,encoding='utf-8') as f: export=json.load(f)
    if export['format']!='hospital-fabric-type3-export/v2' or export['state']['protocol']!='hospital-fabric-type3-commands/v2': raise ValueError('Unsupported protocol; do not apply v2 data to the v1 twin')
    if digest(export['state'])!=export['stateDigest']: raise ValueError('Snapshot digest mismatch')
    commands=export['commands']
    if len(commands)!=export['state']['version'] or [x['sequence'] for x in commands]!=list(range(1,len(commands)+1)): raise ValueError('Incomplete journal')
    if a.url:
        url=urllib.parse.urlparse(a.url)
        if url.scheme!='http' or url.hostname not in ('127.0.0.1','localhost','::1'): raise ValueError('Only local HTTP test runtimes are allowed')
        token=os.environ.get('TYPE3_API_KEY','')
        if len(token)<32: raise ValueError('Set TYPE3_API_KEY')
        def request(path,value=None):
            data=None if value is None else json.dumps(value).encode()
            req=urllib.request.Request(a.url.rstrip('/')+path,data=data,headers={'x-type3-token':token,'content-type':'application/json'})
            with urllib.request.urlopen(req,timeout=10) as response: return json.load(response)
        if request('/v2/protocol')['protocol']!='hospital-fabric-type3-commands/v2': raise ValueError('Runtime protocol mismatch')
        study=request('/v2/studies',{'id':a.study,'profile':export['state']['profile']['id']})
        if study['state']['version']!=0: raise ValueError('Use a fresh study to avoid overwriting existing research')
        for item in commands:
            result=request('/v2/studies/'+urllib.parse.quote(a.study,safe='')+'/commands',item['command'])
            if result['stateDigest']!=item['stateDigest']: raise ValueError('Replay divergence at '+str(item['sequence']))
        print('Live transition replay verified:',len(commands),'commands')
    else: print('Checksum and journal structure verified; transition replay NOT run (pass --url for that).')
    print(export['stateDigest'])
if __name__=='__main__': main()
