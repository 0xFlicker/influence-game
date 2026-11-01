import base64
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile
spec=importlib.util.spec_from_file_location('release',Path(__file__).with_name('staging-release-source.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SourceTests(unittest.TestCase):
    def setUp(self):
        self.run={'repository':{'id':1183905474},'head_repository':{'id':1183905474},'path':'.github/workflows/ci.yml','head_branch':'main','status':'completed','conclusion':'success','event':'push','head_sha':'a'*40,'id':123,'run_attempt':2}
        self.manifest={'schema_version':1,'candidate_sha':'a'*40,'build_run_id':123,'build_run_attempt':2,'migration_set':'sha256:'+'b'*64,'images':{k:{'digest':'sha256:'+c*64} for k,c in [('api','c'),('web','d'),('render_worker','e')]}}
        self.name='influence-release-manifest-'+'a'*40+'-123-2'
        self.policy={'schemaVersion':1,'environments':{'staging':{'mode':'remote','network':'tailnet','apiOrigin':'https://influence-staging.tail8a79ed.ts.net'}}}
        self.archive_name='release-manifest.json'; self.expired=False;self.count=1;self.bad_hash=False
    def request(self,endpoint):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as archive:archive.writestr(self.archive_name,json.dumps(self.manifest))
        raw=stream.getvalue()
        if '/contents/' in endpoint:return json.dumps({'content':base64.b64encode(json.dumps(self.policy).encode()).decode()}).encode()
        if endpoint.endswith('/zip'):return raw
        return json.dumps({'total_count':self.count,'artifacts':[] if not self.count else [{'id':456,'name':self.name,'expired':self.expired,'workflow_run':{'id':123},'digest':'sha256:'+('0'*64 if self.bad_hash else hashlib.sha256(raw).hexdigest())}]}).encode()
    def test_success_keeps_original_source_attempt_and_family(self):
        result=m.select_release(self.run,self.request)
        self.assertEqual(result['build_run_id'],'123');self.assertEqual(result['build_run_attempt'],'2')
        self.assertEqual(result['worker_digest'],'sha256:'+'e'*64);self.assertEqual(result['mode'],'remote')
    def test_tooling_only_ci_does_not_redeploy(self):
        self.count=0;self.assertEqual(m.select_release(self.run,self.request),{'eligible':'false'})
    def test_untrusted_or_nonterminal_source_never_downloads(self):
        for key,value in [('status','in_progress'),('conclusion','failure'),('head_branch','other'),('event','pull_request'),('repository',{'id':1}),('head_repository',{'id':1}),('proofSource',{'purpose':'isolated-staging-render-proof'})]:
            with self.subTest(key=key),self.assertRaises(ValueError):m.select_release({**self.run,key:value},lambda _:self.fail('untrusted source downloaded'))
    def test_wrong_attempt_or_family_rejected(self):
        for key,value in [('build_run_attempt',3),('candidate_sha','f'*40),('images',{'api':{'digest':'sha256:'+'c'*64}})]:
            old=copy.deepcopy(self.manifest);self.manifest[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError):m.select_release(self.run,self.request)
            self.manifest=old
    def test_archive_identity_and_paths_rejected(self):
        for key,value in [('expired',True),('count',2),('bad_hash',True),('archive_name','../release-manifest.json'),('name','wrong')]:
            old=getattr(self,key);setattr(self,key,value)
            with self.subTest(key=key),self.assertRaises(ValueError):m.select_release(self.run,self.request)
            setattr(self,key,old)
    def test_invalid_policy_rejected(self):
        self.policy['environments']['staging']['mode']='surprise'
        with self.assertRaises(ValueError):m.select_release(self.run,self.request)
if __name__=='__main__':unittest.main()
