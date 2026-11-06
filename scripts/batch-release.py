"""Dispatch infra main after publication, then await and verify its exact admission."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time

spec = importlib.util.spec_from_file_location('admission', Path(__file__).with_name('verify-batch-admission.py'))
admission = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admission)


def deploy(env, request=admission.github, dispatch=None, sleep=time.sleep):
    identity = admission.expected(env)
    inputs = {key: str(identity[field]) for key, field in [
        ('source_run_id', 'sourceRunId'), ('source_run_attempt', 'sourceRunAttempt'),
        ('mirror_run_id', 'mirrorRunId'), ('mirror_run_attempt', 'mirrorRunAttempt'),
        ('mirror_receipt_digest', 'mirrorReceiptDigest'), ('release_manifest_digest', 'manifestDigest')]}
    if dispatch is None:
        def dispatch(payload):
            result = subprocess.run(['gh', 'api', '-H', 'X-GitHub-Api-Version: 2026-03-10', '--method', 'POST',
                                     admission.REPO + f"/actions/workflows/house-render-batch-{identity['environment']}-deploy.yml/dispatches",
                                     '--input', '-'], input=json.dumps(payload).encode(), capture_output=True, timeout=60)
            admission.require(result.returncode == 0, 'Batch workflow dispatch failed; diagnostics withheld')
            return json.loads(result.stdout)
    environment = identity['environment']
    if environment == 'prod':
        inputs.update({key: str(identity[field]) for key, field in [
            ('approval_run_id', 'approvalRunId'), ('approval_run_attempt', 'approvalRunAttempt'),
            ('approval_artifact', 'approvalArtifact'), ('approval_receipt_digest', 'approvalReceiptDigest')]})
    started = dispatch({'ref': 'main', 'inputs': inputs})
    run_id = started.get('workflow_run_id')
    admission.require(type(run_id) is int and run_id > 0, 'dispatch did not return an exact run identity')
    for _ in range(120):
        run = json.loads(request(f'{admission.REPO}/actions/runs/{run_id}/attempts/1'))
        if run.get('status') == 'completed':
            env = {**env, 'BATCH_ADMISSION_RUN_ID': str(run_id), 'BATCH_ADMISSION_RUN_ATTEMPT': '1'}
            receipt, digest = admission.verify(env, request)
            return {'batch_admission_run_id': str(run_id), 'batch_admission_run_attempt': '1',
                    'batch_admission_receipt_digest': digest}, receipt
        sleep(20)
    raise ValueError('Batch admission timed out; host deployment was not dispatched')


if __name__ == '__main__':
    try:
        outputs, receipt = deploy(os.environ)
        Path('batch-admission.json').write_text(json.dumps({'required': True, **receipt}, indent=2) + '\n')
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(''.join(f'{key}={value}\n' for key, value in outputs.items()))
    except Exception:
        raise SystemExit('Automatic Batch admission failed; host deployment was not dispatched')
