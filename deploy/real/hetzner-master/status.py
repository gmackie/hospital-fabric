#!/usr/bin/env python3
"""Report readiness and optional recent container logs, without exposing host secrets."""
import os,json,pathlib,subprocess,sys,urllib.request
os.environ['XDG_RUNTIME_DIR']='/run/hospital-fabric/runtime'
base=pathlib.Path('/mnt/master-apps/hospital-fabric')
podman=['podman','--root='+str(base/'containers'),'--runroot=/run/hospital-fabric/storage','--runtime=runc']
secrets_path=base/'private/deployment.env'
private=[line.split('=',1)[1] for line in secrets_path.read_text().splitlines() if 'PASSWORD=' in line] if secrets_path.exists() else []
def redact(text):
 for value in private: text=text.replace(value,'[REDACTED]')
 return text
if len(sys.argv)>1:
 name=sys.argv[1]
 if not name.startswith(('hf-openmrs-','hf-openelis-','hf-oe-')): raise ValueError('Not a Hospital Fabric container')
 result=subprocess.run(podman+['logs','--tail','60',name],capture_output=True,text=True)
 print(redact(result.stdout+result.stderr))
else:
 result=subprocess.run(podman+['ps','-a','--format','json'],capture_output=True,text=True,check=True)
 rows=json.loads(result.stdout)
 print(json.dumps([{'names':r.get('Names'),'state':r.get('State'),'status':r.get('Status'),'image':r.get('Image'),'ports':r.get('Ports')} for r in rows],indent=2))
 for name,url in [('OpenMRS','http://127.0.0.1:18090/openmrs/health/ready'),('OpenMRS FHIR','http://127.0.0.1:18090/openmrs/ws/fhir2/R4/metadata'),('OpenELIS FHIR','http://127.0.0.1:18091/fhir/metadata'),('OpenELIS HTTP redirect','http://127.0.0.1:18092/')]:
  try:
   with urllib.request.urlopen(url,timeout=5) as response: print(name,response.status,response.headers.get('content-type'))
  except Exception as error: print(name,type(error).__name__,str(error)[:100])
