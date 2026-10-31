import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('mirror', Path(__file__).with_name('staging-ecr-mirror.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def body_digest(body):
    raw = json.dumps(body, separators=(',', ':')).encode()
    return raw, 'sha256:' + hashlib.sha256(raw).hexdigest()

class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.raw, self.digest = body_digest({'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
            'config': {'digest': 'sha256:' + 'c'*64, 'size': 100}, 'layers': [{'digest': 'sha256:' + 'd'*64, 'size': 1024}]})
        self.calls = []
        self.images = []
        self.identity = {'Account': m.ACCOUNT, 'Arn': 'arn:aws:sts::' + m.ACCOUNT + ':assumed-role/HouseRenderStagingWorkerImagePublisher/test'}
        self.repo = {'repositoryUri': m.REGISTRY + '/house-render-staging-worker', 'imageTagMutability': 'IMMUTABLE', 'encryptionConfiguration': {'encryptionType': 'AES256'}}
        self.copied_digest = self.digest
        self.lifecycle = None
        self.mirror = m.Mirror('worker', '/private/test-auth', self.runner)
    def test_proof_build_requires_independent_main_source_attestation(self):
        run={'repository':{'id':1183905474},'path':'.github/workflows/ci.yml','head_branch':'proof/staging-render-one','conclusion':'success','event':'workflow_dispatch','head_sha':'a'*40,'id':123,'run_attempt':1,'actor':{'id':97764360}}
        with self.assertRaises(ValueError):m.source_run('worker',run)
        run['proofSource']={'purpose':'isolated-staging-render-proof','candidateSha':'a'*40,'baseSha':'b'*40,'policyFileSha256':'sha256:'+'c'*64}
        self.assertEqual(m.source_run('worker',run),'a'*40)
        for key,value in [('actor',{'id':1}),('event','push'),('head_branch','feature/other')]:
            with self.assertRaises(ValueError):m.source_run('worker',{**run,key:value})
    def runner(self, argv, **kwargs):
        self.calls.append(argv)
        self.assertTrue(kwargs['capture_output'])
        if argv[0] == 'skopeo':
            if 'copy' in argv:
                Path(argv[argv.index('--digestfile')+1]).write_text(self.copied_digest)
                return SimpleNamespace(returncode=0, stdout=b'')
            if '--raw' in argv: return SimpleNamespace(returncode=0, stdout=self.raw)
            return SimpleNamespace(returncode=0, stdout=b'{"os":"linux","architecture":"amd64"}')
        if argv[1:3] == ['sts', 'get-caller-identity']: data = self.identity
        elif argv[1:3] == ['ecr', 'describe-repositories']: data = {'repositories': [self.repo]}
        elif argv[1:3] == ['ecr', 'get-lifecycle-policy']:
            if self.lifecycle is None:return SimpleNamespace(returncode=1,stdout=b'',stderr=b'LifecyclePolicyNotFoundException')
            data={'lifecyclePolicyText':json.dumps(self.lifecycle)}
        elif '--image-ids' in argv: data = {'imageDetails': [{'imageDigest': self.digest}]}
        else: data = {'imageDetails': self.images}
        return SimpleNamespace(returncode=0, stdout=json.dumps(data).encode())
    def test_measure_reads_metadata_only_and_counts_compressed_content(self):
        self.assertEqual(self.mirror.measure(self.digest), len(self.raw)+1124)
        self.assertTrue(all(a[0] == 'skopeo' and 'copy' not in a for a in self.calls))
    def test_preserving_copy_and_destination_digest_are_both_required(self):
        self.mirror.measure(self.digest)
        result = self.mirror.publish(self.digest)
        copy = next(a for a in self.calls if 'copy' in a)
        for flag in ['--all', '--preserve-digests', '--quiet']: self.assertIn(flag, copy)
        self.assertIn('docker://' + m.REGISTRY + '/house-render-staging-worker:sha256-' + self.digest[7:], copy)
        self.assertEqual(result['verifiedDestinationDigest'], self.digest)
        self.assertEqual(result['retainedReleaseDigests'], 1)
    def test_digest_rewrite_is_rejected(self):
        self.mirror.measure(self.digest); self.copied_digest = 'sha256:'+'f'*64
        with self.assertRaisesRegex(ValueError, 'copied digest'): self.mirror.publish(self.digest)
    def test_wrong_identity_and_mutable_repository_never_copy(self):
        self.mirror.measure(self.digest)
        self.identity['Arn'] = self.identity['Arn'].replace('WorkerImagePublisher', 'TailnetImagePublisher')
        with self.assertRaisesRegex(ValueError, 'identity'): self.mirror.publish(self.digest)
        self.identity['Arn'] = self.identity['Arn'].replace('TailnetImagePublisher', 'WorkerImagePublisher')
        self.repo['imageTagMutability'] = 'MUTABLE'
        with self.assertRaisesRegex(ValueError, 'repository'): self.mirror.publish(self.digest)
        self.assertFalse(any('copy' in a for a in self.calls))
    def test_two_retained_releases_and_foreign_tags_require_operator_review(self):
        self.mirror.measure(self.digest)
        self.images = [{'imageDigest':'sha256:'+c*64,'imageTags':['sha256-'+c*64]} for c in ['a','b']]
        with self.assertRaisesRegex(ValueError, 'two retained'): self.mirror.publish(self.digest)
        self.images = [{'imageDigest':self.digest,'imageTags':['latest']}]
        with self.assertRaisesRegex(ValueError, 'foreign'): self.mirror.publish(self.digest)
        self.assertFalse(any('copy' in a for a in self.calls))
    def test_storage_admission_blocks_before_copy(self):
        self.mirror.measure(self.digest)
        self.mirror.selected = {**self.mirror.selected, 'budget': 1}
        with self.assertRaisesRegex(ValueError, 'storage'): self.mirror.publish(self.digest)
        self.assertFalse(any('copy' in a for a in self.calls))
    def test_existing_verified_digest_is_idempotent_and_never_deleted(self):
        self.mirror.measure(self.digest)
        self.images = [{'imageDigest':self.digest,'imageTags':['sha256-'+self.digest[7:]]}]
        self.assertEqual(self.mirror.publish(self.digest)['retainedReleaseDigests'],1)
        self.assertFalse(any('copy' in a or any('delete' in x.lower() for x in a) for a in self.calls))
    def test_installed_lifecycle_must_protect_exact_incoming_root(self):
        self.mirror.measure(self.digest)
        final={'rulePriority':2,'selection':{'tagStatus':'any','countType':'imageCountMoreThan','countNumber':5}}
        self.lifecycle={'rules':[final]}
        with self.assertRaisesRegex(ValueError,'lifecycle must protect'):self.mirror.publish(self.digest)
        self.assertFalse(any('copy' in a for a in self.calls))
        self.lifecycle['rules'].insert(0,{'rulePriority':1,'selection':{'tagStatus':'tagged','tagPatternList':['sha256-'+self.digest[7:]],'countType':'imageCountMoreThan','countNumber':1}})
        self.assertTrue(self.mirror.publish(self.digest)['lifecycleInstalled'])
    def test_raw_manifest_hash_must_match_and_command_diagnostics_are_not_exposed(self):
        with self.assertRaisesRegex(ValueError, 'manifest digest'): self.mirror.measure('sha256:'+'a'*64)
        rejected = m.Mirror('worker','/private/test-auth',lambda *a,**k:SimpleNamespace(returncode=1,stdout=b'',stderr=b'test-only-private-credential'))
        with self.assertRaises(ValueError) as caught: rejected.measure(self.digest)
        self.assertNotIn('test-only-private',str(caught.exception))
    def test_all_index_children_are_measured_without_changing_root_digest(self):
        other, other_digest = body_digest({'schemaVersion':2,'mediaType':'application/vnd.oci.image.manifest.v1+json',
            'config':{'digest':'sha256:'+'f'*64,'size':200},'layers':[{'digest':'sha256:'+'d'*64,'size':1024}]})
        root, root_digest = body_digest({'schemaVersion':2,'mediaType':'application/vnd.oci.image.index.v1+json',
            'manifests':[{'digest':self.digest,'platform':{'os':'linux','architecture':'amd64'}},{'digest':other_digest,'platform':{'os':'linux','architecture':'arm64'}}]})
        manifests={self.digest:self.raw,other_digest:other,root_digest:root}
        def runner(argv,**kwargs):
            if '--raw' in argv: return SimpleNamespace(returncode=0,stdout=manifests[argv[-1].split('@')[1]])
            return self.runner(argv,**kwargs)
        mirror=m.Mirror('worker','/private/test-auth',runner)
        self.assertEqual(mirror.measure(root_digest),len(self.raw)+len(other)+len(root)+100+200+1024)
        self.assertEqual(len(mirror.visited),3)
    def test_five_counts_manifests_not_tags_and_exception_requires_explicit_limit(self):
        manifests={}
        children=[]
        for i in range(5):
            raw,digest=body_digest({'schemaVersion':2,'mediaType':'application/vnd.oci.image.manifest.v1+json',
                'config':{'digest':'sha256:'+hashlib.sha256(str(i).encode()).hexdigest(),'size':100},
                'layers':[{'digest':'sha256:'+'d'*64,'size':1024}]})
            manifests[digest]=raw; children.append({'digest':digest,'platform':{'os':'linux','architecture':'amd64'}})
        raw,digest=body_digest({'schemaVersion':2,'mediaType':'application/vnd.oci.image.index.v1+json','manifests':children})
        manifests[digest]=raw; self.digest=digest; self.copied_digest=digest
        def runner(argv,**kwargs):
            if '--raw' in argv:return SimpleNamespace(returncode=0,stdout=manifests[argv[-1].split('@')[1]])
            return self.runner(argv,**kwargs)
        mirror=m.Mirror('worker','/private/test-auth',runner)
        mirror.measure(digest)
        with self.assertRaisesRegex(ValueError,'five-image'):mirror.publish(digest)
        self.assertFalse(any('copy' in a for a in self.calls))
        mirror.max_manifests=6
        self.assertEqual(mirror.publish(digest)['manifestCount'],6)

class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.run = {'repository':{'id':1183905474},'path':'.github/workflows/ci.yml','head_branch':'main','conclusion':'success','event':'push','head_sha':'a'*40,'id':123,'run_attempt':2}
        self.evidence = {'schema_version':1,'candidate_sha':'a'*40,'build_run_id':123,'build_run_attempt':2,'migration_set':'sha256:'+'b'*64,
                         'images':{name:{'digest':'sha256:'+c*64} for name,c in [('api','c'),('web','d'),('render_worker','e')]}}
    def test_exact_three_image_release_family_selects_only_original_worker_digest(self):
        self.assertEqual(m.evidence_identity('worker',self.evidence,self.run),('a'*40,'sha256:'+'e'*64))
    def test_wrong_repo_branch_run_attempt_or_incomplete_family_fails(self):
        for field,value in [('head_branch','other'),('event','pull_request'),('conclusion','failure'),('repository',{'id':1}),('run_attempt',3)]:
            with self.subTest(field=field), self.assertRaises(ValueError): m.evidence_identity('worker',self.evidence,{**self.run,field:value})
        del self.evidence['images']['web']
        with self.assertRaises(ValueError): m.evidence_identity('worker',self.evidence,self.run)
    def test_sidecar_receipt_keeps_published_digest_platform_and_source_run(self):
        run = {**self.run,'repository':{'id':1405952636},'path':'.github/workflows/house-render-tailnet-image.yml','event':'workflow_dispatch'}
        evidence = {'sourceSha':'a'*40,'baseImage':'tailscale/tailscale@sha256:'+'b'*64,'platform':'linux/amd64','image':'ghcr.io/falsefloor/house-render-tailnet@sha256:'+'c'*64}
        self.assertEqual(m.evidence_identity('tailnet',evidence,run),('a'*40,'sha256:'+'c'*64))
        with self.assertRaises(ValueError): m.evidence_identity('tailnet',{**evidence,'platform':'linux/arm64'},run)

if __name__ == '__main__': unittest.main()
