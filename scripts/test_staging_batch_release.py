import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch
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

    def test_new_run_may_be_missing_before_becoming_visible(self):
        dispatches = []
        requests = []
        waits = []

        def dispatch(body):
            dispatches.append(body)
            return {'workflow_run_id': 56}

        def request(endpoint):
            requests.append(endpoint)
            if len(requests) == 1:
                raise m.admission.GitHubReadError(404)
            if len(requests) == 2:
                return json.dumps({**self.fixture.run, 'status': 'queued'}).encode()
            return self.fixture.request(endpoint)

        outputs, _ = m.deploy(self.fixture.env, request, dispatch, waits.append)
        self.assertEqual(len(dispatches), 1)
        self.assertEqual(requests[:4], [f'{m.admission.REPO}/actions/runs/56/attempts/1'] * 4)
        self.assertEqual(waits, [5, 20])
        self.assertEqual(outputs['batch_admission_run_id'], '56')

    def test_transient_evidence_errors_have_bounded_retries(self):
        waits = []
        requests = []

        def request(endpoint):
            requests.append(endpoint)
            raise m.admission.GitHubReadError(503)

        with self.assertRaisesRegex(m.admission.GitHubReadError, 'HTTP 503'):
            m.deploy(self.fixture.env, request, lambda _: {'workflow_run_id': 56}, waits.append)
        self.assertEqual(len(requests), 4)
        self.assertEqual(waits, [5, 10, 20])

    def test_forbidden_reads_are_not_retried(self):
        def request(_):
            raise m.admission.GitHubReadError(403)

        with self.assertRaisesRegex(m.admission.GitHubReadError, 'HTTP 403'):
            m.deploy(self.fixture.env, request, lambda _: {'workflow_run_id': 56},
                     lambda _: self.fail('retried forbidden evidence read'))

    def test_cli_error_reports_only_http_status(self):
        response = subprocess.CompletedProcess([], 1, b'', b'gh: Not Found (HTTP 404)\nprivate detail')
        with patch.object(m.admission.subprocess, 'run', return_value=response):
            with self.assertRaisesRegex(m.admission.GitHubReadError, r'^GitHub evidence read failed \(HTTP 404\)$') as error:
                m.admission.github('repos/example/infra/actions/runs/56/attempts/1')
        self.assertTrue(error.exception.retryable)

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
