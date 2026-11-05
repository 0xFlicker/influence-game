import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('admission', Path(__file__).with_name('verify-batch-admission.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class AdmissionTests(unittest.TestCase):
    def setUp(self):
        digest = 'sha256:' + 'b' * 64
        self.env = {'CANDIDATE_SHA': 'a' * 40, 'WORKER_DIGEST': digest, 'RENDER_CONFIG_DIGEST': digest,
                    'RELEASE_MANIFEST_DIGEST': digest, 'WORKER_MIRROR_RECEIPT_DIGEST': digest,
                    'BUILD_RUN_ID': '12', 'BUILD_RUN_ATTEMPT': '2', 'WORKER_MIRROR_RUN_ID': '34',
                    'WORKER_MIRROR_RUN_ATTEMPT': '1', 'BATCH_ADMISSION_RUN_ID': '56', 'BATCH_ADMISSION_RUN_ATTEMPT': '1'}
        self.run = {'id': 56, 'run_attempt': 1, 'status': 'completed', 'conclusion': 'success',
                    'event': 'workflow_dispatch', 'head_branch': 'main', 'head_sha': 'c' * 40,
                    'path': '.github/workflows/house-render-batch-staging-deploy.yml',
                    'repository': {'id': 1405952636, 'owner': {'id': 334422757}}, 'head_repository': {'id': 1405952636}}
        self.receipt = {'schemaVersion': 1, 'state': 'admitted', 'environment': 'staging', **m.expected(self.env),
                        'infraSha': 'c' * 40, 'deploymentRunId': 56, 'deploymentRunAttempt': 1,
                        'workerImage': m.ECR + digest, 'submitUrl': 'https://abc.lambda-url.us-west-1.on.aws/',
                        'lanes': {lane: {'queueArn': 'arn:aws:batch:us-west-1:978355607658:job-queue/house-render-batch-staging-' + lane,
                                        'definitionArn': 'arn:aws:batch:us-west-1:978355607658:job-definition/house-render-batch-staging-' + lane + ':2'}
                                  for lane in ('trailer', 'studio-export')}}
        self.member = 'batch-admission.json'
        self.expired = False
        self.archive_digest_bad = False

    def request(self, endpoint):
        if '/attempts/' in endpoint:
            return json.dumps(self.run).encode()
        raw = json.dumps(self.receipt).encode()
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr(self.member, raw)
        packed = stream.getvalue()
        if endpoint.endswith('/zip'):
            return packed
        return json.dumps({'total_count': 1, 'artifacts': [{'id': 78, 'expired': self.expired,
            'name': 'house-render-batch-admission-56-1', 'workflow_run': {'id': 56},
            'digest': 'sha256:' + ('0' * 64 if self.archive_digest_bad else hashlib.sha256(packed).hexdigest())}]}).encode()

    def test_exact_receipt_and_body_digest(self):
        receipt, digest = m.verify(self.env, self.request)
        self.assertEqual(receipt, self.receipt)
        self.assertEqual(digest, 'sha256:' + hashlib.sha256(json.dumps(self.receipt).encode()).hexdigest())
        self.env['BATCH_ADMISSION_RECEIPT_DIGEST'] = digest
        m.verify(self.env, self.request)

    def test_untrusted_or_unsuccessful_workflow_never_downloads(self):
        for key, value in [('conclusion', 'failure'), ('status', 'in_progress'), ('run_attempt', 2),
                            ('head_branch', 'proof'), ('event', 'pull_request'), ('head_repository', {'id': 1}),
                            ('repository', {'id': 1}), ('path', '.github/workflows/other.yml')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                m.verify(self.env, lambda endpoint: json.dumps({**self.run, key: value}).encode()
                         if '/attempts/' in endpoint else self.fail('downloaded untrusted artifact'))

    def test_release_replay_or_changed_binding_is_rejected(self):
        for key, value in [('candidateSha', 'd' * 40), ('workerDigest', 'sha256:' + 'e' * 64),
                            ('policyDigest', 'sha256:' + 'e' * 64), ('manifestDigest', 'sha256:' + 'e' * 64),
                            ('sourceRunAttempt', 3), ('mirrorRunId', 35), ('deploymentRunAttempt', 2),
                            ('infraSha', 'f' * 40), ('workerImage', m.ECR + 'sha256:' + 'e' * 64),
                            ('state', 'planned'), ('environment', 'prod')]:
            old = copy.deepcopy(self.receipt)
            self.receipt[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                m.verify(self.env, self.request)
            self.receipt = old

    def test_wrong_route_lane_and_revision_are_rejected(self):
        for modify in (lambda r: r.update(submitUrl='https://untrusted.example/'),
                       lambda r: r['lanes'].pop('trailer'),
                       lambda r: r['lanes']['studio-export'].update(definitionArn='latest'),
                       lambda r: r['lanes']['trailer'].update(queueArn=r['lanes']['studio-export']['queueArn'])):
            old = copy.deepcopy(self.receipt)
            modify(self.receipt)
            with self.assertRaises(ValueError):
                m.verify(self.env, self.request)
            self.receipt = old

    def test_archive_and_receipt_integrity(self):
        for key, value in [('expired', True), ('member', '../batch-admission.json'), ('archive_digest_bad', True)]:
            old = getattr(self, key)
            setattr(self, key, value)
            with self.subTest(key=key), self.assertRaises(ValueError):
                m.verify(self.env, self.request)
            setattr(self, key, old)
        self.env['BATCH_ADMISSION_RECEIPT_DIGEST'] = 'sha256:' + '0' * 64
        with self.assertRaises(ValueError):
            m.verify(self.env, self.request)


if __name__ == '__main__':
    unittest.main()
