#!/usr/bin/env python3
"""Enter one fixed synthetic hemoglobin result; reconcile any uncertain outcome."""
import importlib.util,json,pathlib,re,urllib.parse,urllib.request,urllib.error
b=pathlib.Path('/mnt/master-apps/hospital-fabric');s=importlib.util.spec_from_file_location('a',b/'release/deploy/real/hetzner-master/verify-openelis-access.py');a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
f=b/'private/lab-order-source.json';r=json.loads(f.read_text());catalog=json.loads((b/'private/lab-catalog-evidence.json').read_text())
def persist():f.write_text(json.dumps(r,indent=2)+'\n')
if r.get('accessionPhase')!='verified':raise RuntimeError('Verified correlated accession required')
form=json.loads(a.request('/rest/accession-results?accessionNumber='+urllib.parse.quote(r['accessionNumber'])))
if form.get('nationalId')!=r['input']['patientIdentifier']:raise RuntimeError('Accession patient identity conflict')
items=[item for item in form['testResult'] if item.get('testId')==catalog['testId'] and item.get('sampleItemId')==r['sampleItemId']]
if len(items)!=1:raise RuntimeError('Exactly one correlated hemoglobin analysis required')
item=items[0]
if item['unitsOfMeasure']!='g/dl':raise RuntimeError('Unexpected product units')
if item.get('resultValue'):
 if float(item['resultValue'])!=13.2:raise RuntimeError('Unexpected existing result')
 r['analysisId']=item['analysisId'];r['resultId']=item['resultId'];r['resultPhase']='entered';persist()
 print(json.dumps({'entered':True,'reconciled':True,'analysisId':r['analysisId'],'resultId':r['resultId'],'value':13.2,'units':'g/dl'}));raise SystemExit
if r.get('resultPhase')=='submission_started':raise RuntimeError('Prior result outcome unknown; no replay')
item.pop('resultFile',None)
item.update(resultValue='13.2',rawResultValue='13.2',isModified=True,reportable=True,valid=True,normal=True)
session=json.loads(a.request('/session'));token=session.get('csrf') or session.get('csrfToken')
if not token:
 match=re.search(r'name="_csrf"[^>]*value="([^"]+)"',a.request('/ChangePasswordLogin'));token=match[1] if match else None
if not token:raise RuntimeError('Product CSRF token required')
r['analysisId']=item['analysisId'];r['resultPhase']='submission_started';persist()
request=urllib.request.Request(a.url+'/rest/results-entry/analysis/'+item['analysisId']+'/result',data=json.dumps({'testResult':item}).encode(),method='POST',headers={'Content-Type':'application/json','X-CSRF-TOKEN':token})
try:
 with a.opener.open(request,timeout=30) as response:body=response.read().decode();status=response.status
except urllib.error.HTTPError as error:body=error.read().decode();status=error.code
(b/'private/result-entry-response.json').write_text(body)
if status==400:r['resultPhase']='validation_rejected';persist()
print(json.dumps({'status':status,'response':json.loads(body)}))
if status!=200:raise SystemExit(1)
r['resultPhase']='submitted';persist()
