#!/usr/bin/env python3
"""Accession one durable, accepted synthetic order through the product workflow."""
import importlib.util,json,pathlib,re,urllib.parse,urllib.request,urllib.error
b=pathlib.Path('/mnt/master-apps/hospital-fabric')
s=importlib.util.spec_from_file_location('access',b/'release/deploy/real/hetzner-master/verify-openelis-access.py');a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
f=b/'private/lab-order-source.json';r=json.loads(f.read_text());i=r['input'];order=i['orderNumber']
def persist():f.write_text(json.dumps(r,indent=2)+'\n')
if r.get('inspected',{}).get('state')!='accepted':raise RuntimeError('Product-accepted Task required')
rows=json.loads(a.request('/rest/ElectronicOrders?searchType=IDENTIFIER&searchValue='+urllib.parse.quote(order.lower())))['eOrders']
rows=[row for row in rows if row['externalOrderId']==order and row.get('patientNationalId')==i['patientIdentifier']]
if len(rows)!=1:raise RuntimeError('Exactly one correlated Electronic Order required')
if rows[0].get('labNumber'):
 if r.get('accessionNumber')!=rows[0]['labNumber']:raise RuntimeError('Unexpected accession; reconcile privately')
 saved=json.loads(a.request('/rest/order/search?labNumber='+urllib.parse.quote(r['accessionNumber'])))
 specimens=[sample for sample in saved.get('samples',[]) if sample.get('sampleTypeName')=='Whole Blood' and any(test.get('id')==str(json.loads((b/'private/lab-catalog-evidence.json').read_text())['testId']) for test in sample.get('tests',[]))]
 if not saved.get('id') or saved.get('patientProperties',{}).get('nationalId')!=i['patientIdentifier'] or len(specimens)!=1:raise RuntimeError('Accession identity/specimen persistence mismatch')
 r['accessionPhase']='verified';r['sampleId']=saved['id'];r['sampleItemId']=specimens[0]['sampleItemId'];persist()
 print(json.dumps({'accessioned':True,'accessionNumber':r['accessionNumber'],'reconciled':True,'sampleId':r['sampleId'],'sampleItemId':r['sampleItemId'],'status':rows[0]['status']}));raise SystemExit
if r.get('accessionPhase')=='submission_started':raise RuntimeError('Prior accession outcome unknown; reconcile before any retry')
form=json.loads(a.request('/rest/SamplePatientEntry?ID='+urllib.parse.quote(order)))
patients=json.loads(a.request('/rest/patient-search-results?nationalID='+urllib.parse.quote(i['patientIdentifier'])+'&suppressExternalSearch=true'))['patientSearchResults']
patients=[p for p in patients if p.get('nationalId')==i['patientIdentifier'] and p.get('externalId')==i['patientId']]
if len(patients)!=1:raise RuntimeError('Exactly one correlated product patient required')
patient=json.loads(a.request('/rest/patient-details?patientID='+patients[0]['patientID']))
if patient.get('nationalId')!=i['patientIdentifier']:raise RuntimeError('Patient detail identity conflict')
patient['patientUpdateStatus']='NO_ACTION'
form['patientProperties']=patient
if not r.get('accessionNumber'):
 generated=json.loads(a.request('/rest/SampleEntryGenerateScanProvider'))
 if not generated.get('status') or not generated.get('body'):raise RuntimeError('Accession allocation failed')
 r['accessionNumber']=generated['body'];r['electronicOrderId']=rows[0]['electronicOrderId'];persist()
item=form['sampleOrderItems'];item['labNo']=r['accessionNumber'];item['externalOrderNumber']=order;item['priority']='ROUTINE'
if not item.get('providerPersonId'):raise RuntimeError('Product-resolved provider person required')
# Resolve the supported Whole Blood type and configured active test from product responses.
types=[t for t in form['sampleTypes'] if t['value']=='Whole Blood']
if len(types)!=1:raise RuntimeError('Ambiguous Whole Blood sample type')
catalog=json.loads((b/'private/lab-catalog-evidence.json').read_text())
if catalog['loinc']!='718-7' or catalog['sampleType']!='Whole Blood':raise RuntimeError('Unexpected fixture catalog')
date=form['currentDate'];time=item['receivedTime']
form['sampleXML']=f"<?xml version='1.0' encoding='utf-8'?><samples><sample sampleID='1' typeId='{types[0]['id']}' sampleItemId='' date='{date}' time='{time}' collector='Hospital Fabric Synthetic' quantity='1' uom='' receivedDate='{date}' receivedTime='{time}' tests='{catalog['testId']}' testSectionMap='' testSampleTypeMap='' panels='' rejected='false' rejectReasonId='' initialConditionIds=''/></samples>"
form['orderEntryOnly']=False
form['rememberSiteAndRequester']=False
session=json.loads(a.request('/session'));token=session.get('csrf') or session.get('csrfToken')
if not token:
 match=re.search(r'name="_csrf"[^>]*value="([^"]+)"',a.request('/ChangePasswordLogin'));token=match[1] if match else None
if not token:raise RuntimeError('Product CSRF token required')
(b/'private/accession-payload.json').write_text(json.dumps(form,indent=2))
r['accessionPhase']='submission_started';persist()
request=urllib.request.Request(a.url+'/rest/SamplePatientEntry',data=json.dumps(form).encode(),method='POST',headers={'Content-Type':'application/json','X-CSRF-TOKEN':token})
try:
 with a.opener.open(request,timeout=30) as response:body=response.read().decode();status=response.status
except urllib.error.HTTPError as error:
 body=error.read().decode();status=error.code
(b/'private/accession-response.json').write_text(body)
if status!=200:
 # A validation rejection establishes no write; persistence failures/unknown outcomes remain guarded.
 if status==400:r['accessionPhase']='validation_rejected';persist()
 print(json.dumps({'status':status,'response':json.loads(body)}));raise SystemExit(1)
r['accessionPhase']='submitted';persist()
print(json.dumps({'status':status,'accessionNumber':r['accessionNumber'],'scope':'product workflow submission; verify accession and analysis persistence'}))
