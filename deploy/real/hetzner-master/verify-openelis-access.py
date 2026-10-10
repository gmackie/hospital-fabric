#!/usr/bin/env python3
"""Rotate the packaged initial admin password via the product API, then verify login."""
import http.cookiejar,json,pathlib,re,ssl,urllib.parse,urllib.request,urllib.error
base=pathlib.Path('/mnt/master-apps/hospital-fabric')
values=dict(line.split('=',1) for line in (base/'private/deployment.env').read_text().splitlines())
jar=http.cookiejar.CookieJar()
context=ssl.create_default_context(cafile=str(base/'private/ca.crt'))
opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar),urllib.request.HTTPSHandler(context=context))
url='https://localhost:18443/api/OpenELIS-Global'
def request(path,fields=None):
 data=urllib.parse.urlencode(fields).encode() if fields is not None else None
 with opener.open(url+path,data=data,timeout=20) as response: return response.read().decode()
def login(password):
 try: request('/ValidateLogin?apiCall=true',{'loginName':'admin','password':password})
 except urllib.error.HTTPError as error:
  if error.code == 401: return False
  raise
 return json.loads(request('/session')).get('authenticated') is True
if not login(values['OE_ADMIN_PASSWORD']):
 if not login('adminADMIN!'): raise RuntimeError('Neither private nor packaged initial admin credential authenticated; no further guesses')
 html=request('/ChangePasswordLogin')
 match=re.search(r'name="_csrf"[^>]*value="([^"]+)"',html)
 if not match: raise RuntimeError('Product CSRF token missing from change-password page')
 request('/ChangePasswordLogin?apiCall=true',{'loginName':'admin','password':'adminADMIN!','newPassword':values['OE_ADMIN_PASSWORD'],'confirmPassword':values['OE_ADMIN_PASSWORD'],'_csrf':match[1]})
 if not login(values['OE_ADMIN_PASSWORD']): raise RuntimeError('Private admin credential not verified after rotation')
# Only a sanitized marker is retained; cookies and passwords stay in memory.
(base/'private/openelis-access.ready').write_text('Private admin login verified through OpenELIS session API.\n')
print('OpenELIS private admin login verified.')
