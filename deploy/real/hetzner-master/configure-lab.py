#!/usr/bin/env python3
"""Configure one synthetic hemoglobin fixture via authenticated product APIs."""
import importlib.util,json,pathlib,re,urllib.request
base=pathlib.Path('/mnt/master-apps/hospital-fabric')
spec=importlib.util.spec_from_file_location('access',str(base/'release/deploy/real/hetzner-master/verify-openelis-access.py'))
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
# Resolve catalog identity from the installed API instead of assuming a database id.
rows=json.loads(a.request('/rest/test-catalog/tests?search=hemoglobin&pageSize=100'))['rows']
rows=[row for row in rows if row['name']=='Hemoglobin(Whole Blood)' and row['active'] and row['sampleTypes']==['Whole Blood']]
if len(rows)!=1: raise RuntimeError('Expected exactly one active whole-blood hemoglobin test')
test_id=rows[0]['testId'];path='/rest/test-catalog/tests/'+test_id+'/terminology'
body=json.loads(a.request(path))
if any(m['source']=='LOINC' and m['code']!='718-7' for m in body['mappings']): raise RuntimeError('Existing LOINC differs; refusing replacement')
if not any(m['source']=='LOINC' and m['code']=='718-7' for m in body['mappings']):
 body['mappings'].append({'source':'LOINC','code':'718-7','relationship':'SAME_AS','displayName':'Hemoglobin [Mass/volume] in Blood'})
 session=json.loads(a.request('/session'))
 token=session.get('csrf') or session.get('CSRF') or session.get('csrfToken')
 if not token:
  match=re.search(r'name="_csrf"[^>]*value="([^"]+)"',a.request('/ChangePasswordLogin'))
  if match: token=match[1]
 if not token: raise RuntimeError('No CSRF token; refusing unauthenticated catalog write')
 request=urllib.request.Request(a.url+path,data=json.dumps(body).encode(),method='PUT',headers={'Content-Type':'application/json','X-CSRF-TOKEN':token})
 with a.opener.open(request,timeout=20) as response: updated=json.load(response)
else: updated=body
if not any(m['source']=='LOINC' and m['code']=='718-7' for m in updated['mappings']): raise RuntimeError('LOINC mapping not confirmed')
evidence={'testId':test_id,'name':rows[0]['name'],'active':True,'sampleType':'Whole Blood','loinc':'718-7','scope':'synthetic catalog configuration; laboratory import still requires verification'}
(base/'private/lab-catalog-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
print(json.dumps(evidence))
