#!/usr/bin/env python3
"""Replace image-baked credentials with private synthetic host TLS material."""
import os,pathlib,subprocess
os.umask(0o077)
base=pathlib.Path('/mnt/master-apps/hospital-fabric'); private=base/'private'
values=dict(line.split('=',1) for line in (private/'deployment.env').read_text().splitlines())
def run(*args): subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
ca=private/'ca.crt'; cakey=private/'ca.key'; cert=base/'data/openelis-certs/apache-selfsigned.crt'; key=base/'data/openelis-keys/apache-selfsigned.key'
marker=private/'tls.ready'
if not marker.exists():
 if any(path.exists() for path in [ca,cakey,cert,key]):
  raise RuntimeError('Existing TLS without tls.ready: verify/adopt the complete trust chain or rotate explicitly; refusing partial regeneration')
 run('openssl','req','-x509','-newkey','rsa:3072','-nodes','-days','365','-subj','/CN=Hospital Fabric Synthetic CA','-keyout',str(cakey),'-out',str(ca))
 run('openssl','req','-newkey','rsa:3072','-nodes','-subj','/CN=localhost','-keyout',str(key),'-out',str(private/'tls.csr'))
 extensions=private/'tls.ext'; extensions.write_text('subjectAltName=DNS:localhost,DNS:oe.openelis.org,DNS:fhir.openelis.org,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth,clientAuth\n')
 run('openssl','x509','-req','-in',str(private/'tls.csr'),'-CA',str(ca),'-CAkey',str(cakey),'-CAcreateserial','-days','90','-extfile',str(extensions),'-out',str(cert))
 env=dict(os.environ,HF_STORE_PASSWORD=values['SSL_KEYSTORE_PASSWORD'],XDG_RUNTIME_DIR='/run/hospital-fabric/runtime')
 subprocess.run(['openssl','pkcs12','-export','-name','hf-synthetic','-in',str(cert),'-inkey',str(key),'-certfile',str(ca),'-out',str(base/'data/openelis-keystores/keystore'),'-passout','env:HF_STORE_PASSWORD'],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 trust=base/'data/openelis-keystores/truststore'
 if trust.exists(): trust.rename(trust.with_suffix('.image-default'))
 env.update(HF_TRUST_PASSWORD=values['SSL_TRUSTSTORE_PASSWORD'])
 subprocess.run(['podman','--root='+str(base/'containers'),'--runroot=/run/hospital-fabric/storage','--runtime=runc','run','--rm','--network=none','--entrypoint=keytool','--env','HF_TRUST_PASSWORD','-v',str(private)+':/private:ro','-v',str(trust.parent)+':/stores',values['OE_CERTGEN_IMAGE'],'-importcert','-noprompt','-alias','hf-synthetic-ca','-storetype','PKCS12','-keystore','/stores/truststore','-storepass:env','HF_TRUST_PASSWORD','-file','/private/ca.crt'],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 marker.write_text('Host-issued synthetic TLS; rotate before certificate expiry.\n')
run('openssl','verify','-CAfile',str(ca),str(cert))
run('openssl','x509','-checkend','604800','-noout','-in',str(cert))
for name in ['keystore','truststore']:
 path=base/'data/openelis-keystores'/name; os.chown(path,8443,8443); os.chmod(path,0o640)
os.chmod(cert,0o644); os.chmod(key,0o600)
# Enable HTTP only inside the private container network / host loopback.
server=private/'fhir-server.xml'
text=server.read_text()
connector='<Connector port="8080" protocol="HTTP/1.1" connectionTimeout="20000" />'
if connector not in text: server.write_text(text.replace('<Service name="Catalina">','<Service name="Catalina">\n'+connector))
os.chmod(server,0o644)
print('Host-issued certificates, truststore and explicit private FHIR HTTP connector prepared.')
