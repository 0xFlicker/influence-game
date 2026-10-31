import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('proof_source', Path(__file__).with_name('staging-proof-source.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
OLD = {'schemaVersion': 1, 'environments': {'prod': {'mode': 'local', 'network': 'direct'}, 'staging': {'mode': 'local', 'network': 'tailnet', 'apiOrigin': 'https://influence-staging.tail8a79ed.ts.net'}}}
NEW = copy.deepcopy(OLD); NEW['environments']['staging']['mode'] = 'remote'
class SourceTests(unittest.TestCase):
    def test_only_exact_staging_policy_change(self):
        m.policy_change(json.dumps(OLD).encode(), json.dumps(NEW).encode())
        for field, value in [('prod', {'mode': 'remote', 'network': 'direct'}), ('staging', {'mode': 'remote', 'network': 'direct'})]:
            bad = copy.deepcopy(NEW); bad['environments'][field] = value
            with self.assertRaises(ValueError): m.policy_change(json.dumps(OLD).encode(), json.dumps(bad).encode())
    def test_publication_must_be_owner_dispatched_same_repo_successful_ci(self):
        run={'repository':{'id':1183905474},'path':'.github/workflows/ci.yml','head_branch':'proof/staging-render-one','head_sha':'a'*40,'event':'workflow_dispatch','conclusion':'success','actor':{'id':97764360}}
        m.verify_run(run)
        for key, value in [('actor',{'id':1}),('event','push'),('conclusion','failure'),('head_branch','main'),('path','other.yml'),('head_repository',{'id':1})]:
            with self.assertRaises(ValueError): m.verify_run({**run,key:value})
    def test_commit_and_main_ancestry_are_independently_checked(self):
        commit={'sha':'a'*40,'parents':[{'sha':'b'*40}],'files':[{'filename':m.POLICY,'status':'modified'}]};compare={'status':'ahead','merge_base_commit':{'sha':'b'*40}}
        self.assertEqual(m.verify_commit(commit,compare,json.dumps(OLD).encode(),json.dumps(NEW).encode())['baseSha'],'b'*40)
        for bad in [{**commit,'files':commit['files']+[{'filename':'.github/workflows/ci.yml','status':'modified'}]}, {**commit,'parents':[]}]:
            with self.assertRaises(ValueError): m.verify_commit(bad,compare,b'',b'')
        with self.assertRaises(ValueError): m.verify_commit(commit,{'status':'diverged','merge_base_commit':{'sha':'c'*40}},b'',b'')
if __name__=='__main__': unittest.main()
