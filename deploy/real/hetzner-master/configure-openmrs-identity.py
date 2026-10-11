#!/usr/bin/env python3
"""Stage the supported Initializer identifier-system mapping; restart backend to apply."""
import csv, io, json, os, pathlib
base=pathlib.Path('/mnt/master-apps/hospital-fabric')
record=json.loads((base/'private/openmrs-patient.json').read_text())
if not record.get('patientId') or not record.get('identifierType') or not record['identifier'].startswith('HF-SYNTH-'):
 raise ValueError('Registered synthetic identity required')
target=base/'data/openmrs-app/configuration/fhirpatientidentifiersystems'
target.mkdir(parents=True,exist_ok=True)
output=io.StringIO()
writer=csv.writer(output)
writer.writerow(['Uuid','Void/Retire','Patient identifier type','Url','_order:1000'])
writer.writerow(['b8c5052d-5cd1-5a70-8b52-cf4f621d2aee','',record['identifierType'],'https://med.gmac.io/identifier/synthetic',''])
path=target/'hospital-fabric.csv'
path.write_text(output.getvalue())
os.chown(target,1001,0);os.chown(path,1001,0)
print('Initializer synthetic identifier mapping staged; backend restart and exact FHIR verification required.')
