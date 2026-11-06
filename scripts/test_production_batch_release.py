"""Production admission must bind approval, environment and exact image provenance."""
import copy
import json
import unittest
import test_staging_batch_admission as fixtures
import test_staging_batch_release as release_fixtures


class ProductionAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.f = fixtures.AdmissionTests()
        self.f.setUp()
        self.f.env.update(BATCH_ENVIRONMENT='prod', APPROVAL_RUN_ID='90', APPROVAL_RUN_ATTEMPT='1',
                          APPROVAL_ARTIFACT='production-approval-candidate-90-1', APPROVAL_DIGEST='sha256:' + 'd' * 64)
        self.f.run['path'] = '.github/workflows/house-render-batch-prod-deploy.yml'
        r = self.f.receipt
        r.update(fixtures.m.expected(self.f.env))
        r['workerImage'] = r['workerImage'].replace('staging', 'prod')
        for lane in r['lanes'].values():
            for key in lane:
                lane[key] = lane[key].replace('staging', 'prod')

    def test_approved_production_family_is_admitted(self):
        receipt, _ = fixtures.m.verify(self.f.env, self.f.request)
        self.assertEqual(receipt['environment'], 'prod')
        self.assertEqual(receipt['approvalRunId'], 90)

    def test_missing_stale_approval_and_cross_environment_receipts_fail(self):
        for key, value in [('approvalRunId', 91), ('approvalReceiptDigest', 'sha256:' + '0' * 64),
                           ('environment', 'staging'), ('workerImage', self.f.receipt['workerImage'].replace('prod', 'staging'))]:
            old = copy.deepcopy(self.f.receipt)
            self.f.receipt[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                fixtures.m.verify(self.f.env, self.f.request)
            self.f.receipt = old
        for key in ('APPROVAL_RUN_ID', 'APPROVAL_ARTIFACT', 'APPROVAL_DIGEST'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                fixtures.m.expected({k:v for k,v in self.f.env.items() if k != key})

    def test_production_dispatch_carries_the_exact_existing_approval(self):
        def dispatch(body):
            self.assertEqual(body['inputs']['approval_run_id'], '90')
            self.assertEqual(body['inputs']['approval_receipt_digest'], self.f.env['APPROVAL_DIGEST'])
            self.assertNotIn('worker_image', body['inputs'])
            return {'workflow_run_id': 56}
        outputs, receipt = release_fixtures.m.deploy(self.f.env, self.f.request, dispatch, lambda _: None)
        self.assertEqual(outputs['batch_admission_run_id'], '56')
        self.assertEqual(receipt['approvalArtifact'], 'production-approval-candidate-90-1')


if __name__ == '__main__':
    unittest.main()
