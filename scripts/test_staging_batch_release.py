import importlib.util
import json
from pathlib import Path
import unittest
import test_staging_batch_admission as fixtures

spec = importlib.util.spec_from_file_location('release', Path(__file__).with_name('batch-release.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.AdmissionTests()
        self.fixture.setUp()

    def test_dispatch_provenance_only_and_wait_exact_returned_run(self):
        def dispatch(body):
            self.assertEqual(body['ref'], 'main')
            self.assertEqual(body['inputs']['source_run_attempt'], '2')
            self.assertNotIn('worker_image', body['inputs'])
            self.assertNotIn('submit_url', body['inputs'])
            return {'workflow_run_id': 56}
        calls = []
        def request(endpoint):
            calls.append(endpoint)
            if len(calls) == 1:
                return json.dumps({**self.fixture.run, 'status': 'in_progress'}).encode()
            return self.fixture.request(endpoint)
        waits = []
        outputs, receipt = m.deploy(self.fixture.env, request, dispatch, waits.append)
        self.assertEqual(outputs['batch_admission_run_id'], '56')
        self.assertEqual(waits, [20])
        self.assertEqual(receipt['workerDigest'], self.fixture.env['WORKER_DIGEST'])

    def test_failed_workflow_blocks_admission(self):
        self.fixture.run['conclusion'] = 'failure'
        with self.assertRaises(ValueError):
            m.deploy(self.fixture.env, self.fixture.request, lambda _: {'workflow_run_id': 56}, lambda _: None)

    def test_timeout_emits_no_host_authority(self):
        self.fixture.run['status'] = 'in_progress'
        with self.assertRaisesRegex(ValueError, 'timed out'):
            m.deploy(self.fixture.env, self.fixture.request, lambda _: {'workflow_run_id': 56}, lambda _: None)

    def test_dispatch_must_identify_its_own_run(self):
        for result in ({}, {'workflow_run_id': '56'}, {'workflow_run_id': -1}):
            with self.assertRaises(ValueError):
                m.deploy(self.fixture.env, lambda _: self.fail('guessed a run'), lambda _: result)


if __name__ == '__main__':
    unittest.main()
