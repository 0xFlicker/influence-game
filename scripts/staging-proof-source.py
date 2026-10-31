"""Verify a proof publication differs from trusted main by staging policy only.

No AWS, deployment, host or runtime credentials are used. The GitHub variant is
also used by the main-only image mirror before trusting a proof build receipt.
"""
import argparse
import base64
import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess

REPO = '0xFlicker/influence-game'
POLICY = 'deployment/render-execution.json'
PURPOSE = 'isolated-staging-render-proof'
SHA = re.compile(r'[a-f0-9]{40}\Z')
BRANCH = re.compile(r'proof/staging-render-[a-z0-9-]{1,60}\Z')


def require(value, message):
    if not value:
        raise ValueError(message)


def policy_change(before, after):
    old, new = json.loads(before), json.loads(after)
    require(old['environments']['prod']['mode'] == 'local'
            and old['environments']['staging'] == {'mode': 'local', 'network': 'tailnet',
                'apiOrigin': 'https://influence-staging.tail8a79ed.ts.net'}, 'unexpected baseline renderer policy')
    expected = copy.deepcopy(old)
    expected['environments']['staging']['mode'] = 'remote'
    require(new == expected, 'only staging local-to-remote policy change is permitted')
    return 'sha256:' + hashlib.sha256(after).hexdigest()


def verify_run(run):
    require(run.get('repository', {}).get('id') == 1183905474
            and run.get('head_repository', run.get('repository', {})).get('id') == 1183905474
            and run.get('path', '').split('@')[0] == '.github/workflows/ci.yml'
            and run.get('event') == 'workflow_dispatch' and run.get('conclusion') == 'success'
            and BRANCH.fullmatch(run.get('head_branch', ''))
            and run.get('actor', {}).get('id') == 97764360
            and SHA.fullmatch(run.get('head_sha', '')), 'untrusted proof publication run')


def verify_commit(commit, comparison, before, after):
    require(SHA.fullmatch(commit.get('sha', '')) and len(commit.get('parents', [])) == 1,
            'proof must be one commit on trusted main')
    base = commit['parents'][0]['sha']
    require(SHA.fullmatch(base) and comparison.get('merge_base_commit', {}).get('sha') == base
            and comparison.get('status') in ['ahead', 'identical'], 'proof base is not on main')
    require([(f.get('filename'), f.get('status')) for f in commit.get('files', [])]
            == [(POLICY, 'modified')], 'proof commit changes more than renderer policy')
    return {'purpose': PURPOSE, 'candidateSha': commit['sha'], 'baseSha': base,
            'policyFileSha256': policy_change(before, after)}


def git(*args):
    p = subprocess.run(['git', *args], capture_output=True, check=True)
    return p.stdout


def local(candidate, main):
    require(SHA.fullmatch(candidate), 'full candidate SHA required')
    parents = git('rev-list', '--parents', '-n', '1', candidate).decode().split()
    require(len(parents) == 2, 'one proof commit required')
    base = parents[1]
    subprocess.run(['git', 'merge-base', '--is-ancestor', base, main], check=True, capture_output=True)
    require(git('diff', '--name-status', base, candidate).decode().strip() == 'M\t' + POLICY,
            'proof commit changes more than renderer policy')
    return {'purpose': PURPOSE, 'candidateSha': candidate, 'baseSha': base,
            'policyFileSha256': policy_change(git('show', base + ':' + POLICY), git('show', candidate + ':' + POLICY))}


def api(path):
    p = subprocess.run(['gh', 'api', 'repos/' + REPO + '/' + path], capture_output=True, check=True)
    return json.loads(p.stdout)


def attest(run):
    verify_run(run)
    sha = run['head_sha']
    commit = api('commits/' + sha)
    require(commit.get('sha') == sha and len(commit.get('parents', [])) == 1, 'commit differs from source run')
    base = commit['parents'][0]['sha']
    require(SHA.fullmatch(base), 'invalid proof base')
    comparison = api('compare/' + base + '...main')
    def content(ref):
        value = api('contents/' + POLICY + '?ref=' + ref)
        require(value.get('encoding') == 'base64' and value.get('path') == POLICY, 'policy content unavailable')
        return base64.b64decode(value['content'], validate=False)
    return verify_commit(commit, comparison, content(base), content(sha))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate')
    parser.add_argument('--main-ref', default='origin/main')
    parser.add_argument('--run-metadata', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.run_metadata:
            run = json.loads(args.run_metadata.read_text())
            run['proofSource'] = attest(run)
            result = run
        else:
            result = local(args.candidate, args.main_ref)
        args.output.write_text(json.dumps(result, indent=2) + '\n')
    except Exception:
        raise SystemExit('Proof publication source rejected; no deployment or credential operation performed')


if __name__ == '__main__':
    main()
