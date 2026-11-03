"""Select an exact release only after its producing CI attempt has succeeded."""
import argparse
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import zipfile

spec = importlib.util.spec_from_file_location('mirror', Path(__file__).with_name('staging-ecr-mirror.py'))
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)
REPOSITORY = 'repos/0xFlicker/influence-game'


def require(value, message):
    if not value:
        raise ValueError(message)


def select_release(run, request):
    sha = mirror.source_run('worker', run)
    require(run.get('status') == 'completed' and run.get('head_branch') == 'main'
            and not run.get('proofSource') and run.get('head_repository', {}).get('id') == 1183905474,
            'only completed ordinary main CI may activate staging')
    name = f"influence-release-manifest-{sha}-{run['id']}-{run['run_attempt']}"
    metadata = json.loads(request(f"{REPOSITORY}/actions/runs/{run['id']}/artifacts?name={name}"))
    artifacts = metadata.get('artifacts', [])
    # Tooling-only CI has no release images and must not redeploy an old family.
    if metadata.get('total_count') == 0 and not artifacts:
        return {'eligible': 'false'}
    require(metadata.get('total_count') == 1 and len(artifacts) == 1, 'ambiguous release artifact')
    artifact = artifacts[0]
    require(artifact.get('name') == name and artifact.get('expired') is False
            and artifact.get('workflow_run', {}).get('id') == run['id'] and type(artifact.get('id')) is int,
            'release artifact identity mismatch')
    raw = request(f"{REPOSITORY}/actions/artifacts/{artifact['id']}/zip")
    require(len(raw) <= 2 * 1024**2 and artifact.get('digest') == 'sha256:' + hashlib.sha256(raw).hexdigest(),
            'release archive digest mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        require(archive.namelist() == ['release-manifest.json'] and archive.infolist()[0].file_size <= 512 * 1024,
                'unexpected release archive contents')
        manifest_raw = archive.read('release-manifest.json')
    manifest = json.loads(manifest_raw)
    mirror.evidence_identity('worker', manifest, run)
    policy = json.loads(request(f'{REPOSITORY}/contents/deployment/render-execution.json?ref={sha}'))
    policy_raw = base64.b64decode(policy['content'], validate=False)
    policy = json.loads(policy_raw)
    mode = policy.get('environments', {}).get('staging', {}).get('mode')
    require(policy.get('schemaVersion') == 1 and mode in ['local', 'remote'], 'missing staging execution policy')
    selected = policy['environments']['staging']
    targets = selected.get('targets', {'trailer': 'existing', 'studio-export': 'existing'})
    require(isinstance(targets, dict) and set(targets) == {'trailer', 'studio-export'}
            and all(target in ('existing', 'aws-batch') for target in targets.values()), 'invalid staging targets')
    batch = 'aws-batch' in targets.values()
    require(not batch or (mode == 'remote' and selected.get('network') == 'tailnet'
                         and selected.get('apiOrigin') == 'https://influence-staging.tail8a79ed.ts.net'),
            'Batch requires the canonical remote staging policy')
    return {'eligible': 'true', 'mode': mode, 'candidate_sha': sha, 'build_run_id': str(run['id']),
            'batch_required': str(batch).lower(), 'policy_digest': 'sha256:' + hashlib.sha256(policy_raw).hexdigest(),
            'build_run_attempt': str(run['run_attempt']), 'release_manifest_artifact': name,
            'release_manifest_digest': 'sha256:' + hashlib.sha256(manifest_raw).hexdigest(),
            'migration_set': manifest['migration_set'],
            **{key + '_digest': manifest['images'][service]['digest'] for key, service in
               [('api', 'api'), ('web', 'web'), ('worker', 'render_worker')]}}


def github(endpoint):
    result = subprocess.run(['gh', 'api', endpoint], capture_output=True, timeout=60)
    require(result.returncode == 0, 'release evidence read failed; diagnostics withheld')
    return result.stdout


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-metadata', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    try:
        result = select_release(json.loads(Path(args.run_metadata).read_bytes()), github)
        Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(''.join(f'{key}={value}\n' for key, value in result.items()))
    except Exception:
        raise SystemExit('Staging release evidence rejected; no deployment authority emitted')
