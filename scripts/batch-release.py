"""Dispatch infra main after publication, then await and verify its exact admission."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('admission', Path(__file__).with_name('verify-batch-admission.py'))
admission = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admission)


def read_evidence(request, endpoint, run_id, sleep):
    for delay in (5, 10, 20):
        try:
            return request(endpoint)
        except admission.GitHubReadError as error:
            if not error.retryable:
                raise
            print(f'Batch run {run_id}: {error}; retrying in {delay}s', file=sys.stderr, flush=True)
            sleep(delay)
    return request(endpoint)


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
            admission.require(result.returncode == 0, 'Batch workflow dispatch failed')
            try:
                return json.loads(result.stdout)
            except json.JSONDecodeError:
                raise admission.AdmissionError('Batch dispatch did not return JSON') from None
    environment = identity['environment']
    if environment == 'prod':
        inputs.update({key: str(identity[field]) for key, field in [
            ('approval_run_id', 'approvalRunId'), ('approval_run_attempt', 'approvalRunAttempt'),
            ('approval_artifact', 'approvalArtifact'), ('approval_receipt_digest', 'approvalReceiptDigest')]})
    started = dispatch({'ref': 'main', 'inputs': inputs})
    run_id = started.get('workflow_run_id') if isinstance(started, dict) else None
    admission.require(type(run_id) is int and run_id > 0, 'Batch dispatch did not return an exact run identity')
    print(f'Dispatched exact Batch run {run_id}, attempt 1', flush=True)

    def read(endpoint):
        return read_evidence(request, endpoint, run_id, sleep)

    for _ in range(120):
        run = json.loads(read(f'{admission.REPO}/actions/runs/{run_id}/attempts/1'))
        if run.get('status') == 'completed':
            admission.require(run.get('conclusion') == 'success', f'Batch run {run_id} completed without success')
            env = {**env, 'BATCH_ADMISSION_RUN_ID': str(run_id), 'BATCH_ADMISSION_RUN_ATTEMPT': '1'}
            receipt, digest = admission.verify(env, read)
            return {'batch_admission_run_id': str(run_id), 'batch_admission_run_attempt': '1',
                    'batch_admission_receipt_digest': digest}, receipt
        sleep(20)
    raise admission.AdmissionError(f'Batch run {run_id} timed out waiting for completion')


if __name__ == '__main__':
    try:
        outputs, receipt = deploy(os.environ)
        Path('batch-admission.json').write_text(json.dumps({'required': True, **receipt}, indent=2) + '\n')
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(''.join(f'{key}={value}\n' for key, value in outputs.items()))
    except admission.AdmissionError as error:
        raise SystemExit(f'Automatic Batch admission failed: {error}. Host deployment was not dispatched.') from None
    except Exception as error:
        raise SystemExit(f'Automatic Batch admission failed ({type(error).__name__}). Host deployment was not dispatched.') from None
