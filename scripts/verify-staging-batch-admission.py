"""Verify an infra-owned Batch deployment receipt against one exact staging release.

This contract is also consumed independently by linode-iac before host access.
No credentials, arbitrary URLs or moving image tags are accepted as release inputs.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

REPO = 'repos/falsefloor/infra'
ECR = '978355607658.dkr.ecr.us-west-1.amazonaws.com/house-render-staging-worker@'


def require(value, message):
    if not value:
        raise ValueError(message)


def github(endpoint):
    result = subprocess.run(['gh', 'api', '-H', 'X-GitHub-Api-Version: 2026-03-10', endpoint],
                            capture_output=True, timeout=60)
    require(result.returncode == 0, 'Batch evidence read failed; diagnostics withheld')
    return result.stdout


def expected(env):
    value = {'candidateSha': env['CANDIDATE_SHA'], 'workerDigest': env['WORKER_DIGEST'],
             'policyDigest': env['RENDER_CONFIG_DIGEST'], 'manifestDigest': env['RELEASE_MANIFEST_DIGEST'],
             'mirrorReceiptDigest': env['WORKER_MIRROR_RECEIPT_DIGEST']}
    require(re.fullmatch('[a-f0-9]{40}', value['candidateSha']), 'invalid candidate')
    require(all(re.fullmatch('sha256:[a-f0-9]{64}', value[key]) for key in value if key != 'candidateSha'),
            'invalid release digest')
    for key, name in [('sourceRunId', 'BUILD_RUN_ID'), ('sourceRunAttempt', 'BUILD_RUN_ATTEMPT'),
                      ('mirrorRunId', 'WORKER_MIRROR_RUN_ID'), ('mirrorRunAttempt', 'WORKER_MIRROR_RUN_ATTEMPT')]:
        require(re.fullmatch('[1-9][0-9]*', env.get(name, '')), 'invalid source attempt')
        value[key] = int(env[name])
    return value


def verify(env, request=github):
    identity = expected(env)
    run_id, attempt = [env.get(key, '') for key in ('BATCH_ADMISSION_RUN_ID', 'BATCH_ADMISSION_RUN_ATTEMPT')]
    require(all(re.fullmatch('[1-9][0-9]*', value) for value in (run_id, attempt)), 'missing Batch admission attempt')
    run_id, attempt = int(run_id), int(attempt)
    run = json.loads(request(f'{REPO}/actions/runs/{run_id}/attempts/{attempt}'))
    require(run.get('id') == run_id and run.get('run_attempt') == attempt
            and run.get('status') == 'completed' and run.get('conclusion') == 'success'
            and run.get('event') == 'workflow_dispatch' and run.get('head_branch') == 'main'
            and run.get('path') == '.github/workflows/house-render-batch-staging-deploy.yml'
            and run.get('repository', {}).get('id') == 1405952636
            and run.get('head_repository', {}).get('id') == 1405952636
            and run.get('repository', {}).get('owner', {}).get('id') == 334422757,
            'Batch admission must come from successful infra main')
    name = f'house-render-batch-admission-{run_id}-{attempt}'
    metadata = json.loads(request(f'{REPO}/actions/runs/{run_id}/artifacts?name={name}'))
    artifacts = metadata.get('artifacts', [])
    require(metadata.get('total_count') == 1 and len(artifacts) == 1, 'ambiguous Batch admission artifact')
    record = artifacts[0]
    require(record.get('name') == name and record.get('expired') is False
            and record.get('workflow_run', {}).get('id') == run_id and type(record.get('id')) is int,
            'Batch admission artifact identity mismatch')
    archive_raw = request(f"{REPO}/actions/artifacts/{record['id']}/zip")
    require(len(archive_raw) <= 2 * 1024**2 and record.get('digest') == 'sha256:' + hashlib.sha256(archive_raw).hexdigest(),
            'Batch admission archive digest mismatch')
    with zipfile.ZipFile(io.BytesIO(archive_raw)) as archive:
        require(archive.namelist() == ['batch-admission.json'] and archive.infolist()[0].file_size <= 512 * 1024,
                'unexpected Batch admission archive contents')
        raw = archive.read('batch-admission.json')
    digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
    require(not env.get('BATCH_ADMISSION_RECEIPT_DIGEST') or env['BATCH_ADMISSION_RECEIPT_DIGEST'] == digest,
            'Batch admission receipt digest mismatch')
    receipt = json.loads(raw)
    require(receipt.get('schemaVersion') == 1 and receipt.get('environment') == 'staging'
            and receipt.get('state') == 'admitted' and all(receipt.get(key) == value for key, value in identity.items())
            and receipt.get('deploymentRunId') == run_id and receipt.get('deploymentRunAttempt') == attempt
            and receipt.get('infraSha') == run.get('head_sha') and re.fullmatch('[a-f0-9]{40}', receipt['infraSha'])
            and receipt.get('workerImage') == ECR + identity['workerDigest'], 'Batch admission differs from release')
    require(re.fullmatch(r'https://[a-z0-9]+\.lambda-url\.us-west-1\.on\.aws/', receipt.get('submitUrl', '')),
            'invalid Batch submission URL')
    require(set(receipt.get('lanes', {})) == {'trailer', 'studio-export'}, 'missing Batch lanes')
    for lane, values in receipt['lanes'].items():
        prefix = 'arn:aws:batch:us-west-1:978355607658:'
        name = 'house-render-batch-staging-' + lane
        require(values.get('queueArn') == prefix + 'job-queue/' + name
                and re.fullmatch(re.escape(prefix + 'job-definition/' + name) + r':[1-9][0-9]*', values.get('definitionArn', '')),
                'invalid Batch lane identity')
    return receipt, digest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--selection', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        selection = json.loads(Path(args.selection).read_bytes())
        policy = selection['execution']
        if 'aws-batch' in policy.get('targets', {}).values():
            env = {**os.environ, 'RENDER_CONFIG_DIGEST': policy['configDigest']}
            require(env.get('BATCH_ADMISSION_RECEIPT_DIGEST'), 'missing Batch admission receipt digest')
            receipt, _ = verify(env)
            result = {'required': True, **receipt}
        else:
            require(not any(os.environ.get(key) for key in ('BATCH_ADMISSION_RUN_ID', 'BATCH_ADMISSION_RUN_ATTEMPT',
                                                           'BATCH_ADMISSION_RECEIPT_DIGEST')), 'unexpected Batch admission')
            result = {'required': False}
        Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
        print('Verified staging Batch admission requirement before host access')
    except Exception:
        raise SystemExit('Staging Batch admission rejected before host access')
