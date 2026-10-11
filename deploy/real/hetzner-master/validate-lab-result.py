#!/usr/bin/env python3
"""Release only the fixed, correlated synthetic analysis through product validation."""
import importlib.util,json,pathlib,re,urllib.parse,urllib.request,urllib.error
b=pathlib.Path('/mnt/master-apps/hospital-fabric');s=importlib.util.spec_from_file_location('a',b/'release/deploy/real/hetzner-master/verify-openelis-access.py');a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
f=b/'private/lab-order-source.json';r=json.loads(f.read_text())
if r.get('resultPhase')!='entered':raise RuntimeError('Reconciled result entry required')
form=json.loads(a.request('/rest/AccessionValidation?accessionNumber='+urllib.parse.quote(r['accessionNumber'])+'&doRange=false'))
items=[item for item in form.get('resultList',[]) if item.get('analysisId')==r['analysisId'] and item.get('resultId')==r['resultId'] and item.get('accessionNumber')==r['accessionNumber']]
if len(items)!=1:raise RuntimeError('Exactly one correlated validation row required; reconcile released state separately')
item=items[0]
if float(item['result'])!=13.2 or item['testId']!=json.loads((b/'private/lab-catalog-evidence.json').read_text())['testId'] or r['input']['patientIdentifier'] not in item['patientInfo']:raise RuntimeError('Validation result identity conflict')
if item.get('qcHold') or item.get('critical') or item.get('nceOpen') or not item.get('clear'):raise RuntimeError('Product validation hold requires resolution')
if r.get('validationPhase')=='submission_started':raise RuntimeError('Prior release outcome unknown; no replay')
session=json.loads(a.request('/session'));token=session.get('csrf') or session.get('csrfToken')
if not token:
 match=re.search(r'name="_csrf"[^>]*value="([^"]+)"',a.request('/ChangePasswordLogin'));token=match[1] if match else None
if not token:raise RuntimeError('Product CSRF token required')
r['validationPhase']='submission_started';f.write_text(json.dumps(r,indent=2)+'\n')
request=urllib.request.Request(a.url+'/rest/AccessionValidation/analysis/'+r['analysisId']+'/release',data=json.dumps(item).encode(),method='POST',headers={'Content-Type':'application/json','X-CSRF-TOKEN':token})
try:
 with a.opener.open(request,timeout=30) as response:body=response.read().decode();status=response.status
except urllib.error.HTTPError as error:body=error.read().decode();status=error.code
(b/'private/validation-response.json').write_text(body)
print(json.dumps({'status':status,'response':json.loads(body)}))
if status!=200:raise SystemExit(1)
r['validationPhase']='submitted';f.write_text(json.dumps(r,indent=2)+'\n')
