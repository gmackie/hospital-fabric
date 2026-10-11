#!/usr/bin/env python3
"""Resolve documented release tags to immutable Linux AMD64 registry manifests."""
import concurrent.futures, datetime, json, urllib.request
images = {
 'OMRS_GATEWAY_IMAGE':('openmrs/openmrs-reference-application-3-gateway','3.7.1'),
 'OMRS_FRONTEND_IMAGE':('openmrs/openmrs-reference-application-3-frontend','3.7.1'),
 'OMRS_BACKEND_IMAGE':('openmrs/openmrs-reference-application-3-backend','3.7.1'),
 'OMRS_DATABASE_IMAGE':('library/mariadb','10.11.7'),
 'OE_CERTGEN_IMAGE':('itechuw/certgen','main'),
 'OE_DATABASE_IMAGE':('itechuw/openelis-global-2-database','3.2.3.0'),
 'OE_APP_IMAGE':('itechuw/openelis-global-2','3.2.3.0'),
 'OE_FHIR_IMAGE':('itechuw/openelis-global-2-fhir','3.2.3.0'),
 'OE_FRONTEND_IMAGE':('itechuw/openelis-global-2-frontend','3.2.3.0'),
 'OE_PROXY_IMAGE':('itechuw/openelis-global-2-proxy','3.2.3.0'),
}
def resolve(item):
 key,(repo,tag)=item
 with urllib.request.urlopen(f'https://hub.docker.com/v2/repositories/{repo}/tags/{tag}', timeout=30) as response: data=json.load(response)
 candidates=[i for i in data['images'] if i['architecture']=='amd64' and i.get('os')=='linux']
 if len(candidates)!=1: raise ValueError(f'{key}: expected one Linux AMD64 image')
 image=candidates[0]
 return key,{'sourceTag':f'{repo}:{tag}','image':f'docker.io/{repo}@{image["digest"]}','compressedBytes':image['size'],'tagUpdatedAt':data['last_updated']}
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor: resolved=dict(executor.map(resolve,images.items()))
 print(json.dumps({'resolvedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'platform':'linux/amd64','images':resolved},indent=2))
