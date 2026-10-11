#!/usr/bin/env python3
"""Prepare this authorized synthetic installation. Secrets are generated only on the host."""
import json, os, pathlib, secrets, subprocess, uuid
base=pathlib.Path('/mnt/master-apps/hospital-fabric')
os.umask(0o077)
def run(*args): subprocess.run(args,check=True)
for name in ['private','data','upstream','containers']: (base/name).mkdir(parents=True,exist_ok=True)
for name in ['openmrs-app','openmrs-db','openelis-db','openelis-source-db','openelis-keystores','openelis-certs','openelis-keys','openelis-reports']:
 (base/'data'/name).mkdir(exist_ok=True)
os.chown(base/'data/openmrs-app',1001,0)
refs={'openmrs':('https://github.com/openmrs/openmrs-distro-referenceapplication.git','3.7.1','a476fd609612394ff66fce0b4ce29e949b0cfaf9'),'openelis':('https://github.com/DIGI-UW/OpenELIS-Global-2.git','3.2.3.0','44dbc444fd2d0b037ca6ecc2af5d61e39924125f')}
for name,(url,tag,sha) in refs.items():
 target=base/'upstream'/name
 if not target.exists(): run('git','clone','--depth','1','--branch',tag,url,str(target))
 actual=subprocess.check_output(['git','-C',str(target),'rev-parse','HEAD'],text=True).strip()
 if actual!=sha: raise ValueError(f'{name}: upstream source revision mismatch')
secret_path=base/'private/deployment.env'
if not secret_path.exists():
 values={key:'Aa1!'+secrets.token_hex(24) for key in ['OMRS_DB_PASSWORD','OMRS_ROOT_PASSWORD','OMRS_ADMIN_PASSWORD','OE_POSTGRES_PASSWORD','OE_DB_PASSWORD','ADMIN_PASSWORD','OE_ADMIN_PASSWORD','SSL_KEYSTORE_PASSWORD','SSL_TRUSTSTORE_PASSWORD','OE_ENCRYPTION_PASSWORD']}
 lock=json.loads((base/'release/deploy/real/hetzner-master/images.lock.json').read_text())
 values.update({key:value['image'] for key,value in lock['images'].items()})
 values['OE_COMMON_PROPERTIES_FILE']=str(base/'private/common.properties')
 secret_path.write_text(''.join(f'{key}={value}\n' for key,value in values.items()))
else: values=dict(line.split('=',1) for line in secret_path.read_text().splitlines())
if 'OE_SYNTHETIC_OWNER_ID' not in values:
 values['OE_SYNTHETIC_OWNER_ID']=str(uuid.uuid5(uuid.NAMESPACE_URL,'https://med.gmac.io/synthetic-lab'))
 with secret_path.open('a') as handle: handle.write('OE_SYNTHETIC_OWNER_ID='+values['OE_SYNTHETIC_OWNER_ID']+'\n')
properties=base/'private/common.properties'
if not properties.exists():
 text=(base/'upstream/openelis/volume/properties/common.properties').read_text()
 replacements={'server.ssl.key-store-password':values['SSL_KEYSTORE_PASSWORD'],'server.ssl.key-password':values['SSL_KEYSTORE_PASSWORD'],'server.ssl.trust-store-password':values['SSL_TRUSTSTORE_PASSWORD'],'encryption.general.password':values['OE_ENCRYPTION_PASSWORD'],'org.openelisglobal.fhirstore.uri':'http://fhir.openelis.org:8080/fhir/','org.openelisglobal.remote.source.uri':'http://hf-source-fhir:8080/fhir/','org.openelisglobal.remote.source.identifier':'Practitioner/'+values['OE_SYNTHETIC_OWNER_ID'],'org.openelisglobal.fhir.subscriber':''}
 lines=[]
 for line in text.splitlines():
  key=line.split('=',1)[0].strip()
  lines.append(f'{key}={replacements[key]}' if key in replacements else line)
 properties.write_text('\n'.join(lines)+'\n')
# Compose bind-backed volumes copy image ownership on initial creation.
# The properties reader runs as UID 8443; keep the containing private directory root-only.
os.chown(properties,8443,8443)
os.chmod(properties,0o600)
run('cp',str(base/'release/deploy/real/hetzner-master/podman-api.service'),'/etc/systemd/system/hospital-fabric-podman-api.service')
run('cp',str(base/'release/deploy/real/hetzner-master/stack.service'),'/etc/systemd/system/hospital-fabric-stack.service')
run('systemctl','daemon-reload')
run('systemctl','enable','--now','hospital-fabric-podman-api.service')
os.environ['XDG_RUNTIME_DIR']='/run/hospital-fabric/runtime'
podman=['podman','--root='+str(base/'containers'),'--runroot=/run/hospital-fabric/storage','--runtime=runc']
server=base/'private/fhir-server.xml'
if not server.exists():
 run(*(podman+['pull',values['OE_FHIR_IMAGE']]))
 run(*(podman+['create','--name','hf-config-extractor','--entrypoint','/bin/true',values['OE_FHIR_IMAGE']]))
 try: run(*(podman+['cp','hf-config-extractor:/usr/local/tomcat/conf/server.xml',str(server)]))
 finally: run(*(podman+['rm','hf-config-extractor']))
run(*(podman+['pull',values['OE_CERTGEN_IMAGE']]))
run('python3',str(base/'release/deploy/real/hetzner-master/provision-tls.py'))
print('Pinned sources, isolated persistent storage, host-issued TLS and private host-generated secrets prepared.')
