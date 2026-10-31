"""Manual staging image mirror. Defaults to metadata measurement; never builds/runs images.

Registry credentials are supplied by the operator workflow in a private temporary
auth file. They never appear in arguments, receipts or command diagnostics.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import stat
import tempfile

ACCOUNT = '978355607658'
REGION = 'us-west-1'
REGISTRY = ACCOUNT + '.dkr.ecr.' + REGION + '.amazonaws.com'
DIGEST = re.compile(r'sha256:[a-f0-9]{64}')
KINDS = {
    'worker': {'source': 'ghcr.io/0xflicker/influence-render-worker', 'repository': 'house-render-staging-worker',
               'role': 'HouseRenderStagingWorkerImagePublisher', 'repository_id': 1183905474,
               'workflow': '.github/workflows/ci.yml', 'budget': 3 * 1024**3},
    'tailnet': {'source': 'ghcr.io/falsefloor/house-render-tailnet', 'repository': 'house-render-staging-tailnet',
               'role': 'HouseRenderStagingTailnetImagePublisher', 'repository_id': 1405952636,
               'workflow': '.github/workflows/house-render-tailnet-image.yml', 'budget': 512 * 1024**2},
}

class Rejected(ValueError):
    """Only constant, credential-free diagnostics may reach operator output."""

def require(condition, message):
    if not condition:
        raise Rejected(message)

def source_run(kind, run):
    selected = KINDS[kind]
    require(run.get('repository', {}).get('id') == selected['repository_id'] and
            run.get('path', '').split('@')[0] == selected['workflow'] and
            run.get('head_branch') == 'main' and run.get('conclusion') == 'success' and
            run.get('event') in ['push', 'workflow_dispatch'], 'untrusted source workflow run')
    sha = run.get('head_sha', '')
    require(re.fullmatch(r'[a-f0-9]{40}', sha) is not None and type(run.get('id')) is int and run['id'] > 0 and type(run.get('run_attempt')) is int and run['run_attempt'] > 0, 'invalid source run identity')
    return sha

def evidence_identity(kind, evidence, run):
    selected = KINDS[kind]
    sha = source_run(kind, run)
    if kind == 'worker':
        require(set(evidence) == {'schema_version', 'candidate_sha', 'build_run_id', 'build_run_attempt', 'migration_set', 'images'} and
                evidence['schema_version'] == 1 and evidence['candidate_sha'] == sha and
                evidence['build_run_id'] == run['id'] and evidence['build_run_attempt'] == run['run_attempt'], 'release manifest provenance mismatch')
        require(set(evidence['images']) == {'api', 'web', 'render_worker'} and DIGEST.fullmatch(evidence['migration_set']), 'incomplete release family')
        for image in evidence['images'].values():
            require(set(image) == {'digest'} and DIGEST.fullmatch(image['digest']), 'invalid release image identity')
        digest = evidence['images']['render_worker']['digest']
    else:
        require(set(evidence) == {'sourceSha', 'baseImage', 'image', 'platform'} and evidence['sourceSha'] == sha and
                evidence['platform'] == 'linux/amd64' and re.fullmatch(r'tailscale/tailscale@sha256:[a-f0-9]{64}', evidence['baseImage']), 'sidecar receipt provenance mismatch')
        prefix = selected['source'] + '@'
        require(evidence['image'].startswith(prefix), 'wrong sidecar source repository')
        digest = evidence['image'][len(prefix):]
    require(DIGEST.fullmatch(digest), 'invalid source digest')
    return sha, digest

def verify_lifecycle(policy, tags):
    """Only the reviewed exact-tag protection + five-object policy is accepted."""
    rules = sorted(policy.get('rules', []), key=lambda r:r.get('rulePriority',0))
    require(rules and rules[-1].get('selection') == {'tagStatus':'any','countType':'imageCountMoreThan','countNumber':5}, 'unreviewed lifecycle policy')
    protected = set()
    for rule in rules[:-1]:
        selection = rule.get('selection', {})
        patterns = selection.get('tagPatternList', [])
        require(selection.get('tagStatus') == 'tagged' and selection.get('countType') == 'imageCountMoreThan' and
                selection.get('countNumber') == 1 and len(patterns) == 1 and '*' not in patterns[0], 'unreviewed lifecycle protection rule')
        protected.add(patterns[0])
    require(set(tags) <= protected, 'lifecycle must protect current/rollback and incoming digest tags before copying')

class Mirror:
    def __init__(self, kind, auth_file, runner=subprocess.run, max_manifests=5):
        require(type(max_manifests) is int and 5 <= max_manifests <= 10, 'invalid retention exception limit')
        self.selected = KINDS[kind]
        self.auth_file = str(auth_file)
        self.runner = runner
        self.parts = {}
        self.visited = set()
        self.max_manifests = max_manifests

    def call(self, argv):
        result = self.runner(argv, capture_output=True, timeout=600 if argv[:2] == ['skopeo', 'copy'] else 120)
        require(result.returncode == 0, argv[0] + ' command failed (diagnostics suppressed to protect credentials)')
        return result.stdout if isinstance(result.stdout, bytes) else result.stdout.encode()

    def aws(self, *args):
        return json.loads(self.call(['aws', *args, '--region', REGION, '--output', 'json']))

    def lifecycle(self):
        result = self.runner(['aws','ecr','get-lifecycle-policy','--repository-name',self.selected['repository'],'--region',REGION,'--output','json'],capture_output=True,timeout=120)
        if result.returncode:
            stderr = result.stderr if isinstance(result.stderr,bytes) else result.stderr.encode()
            require(b'LifecyclePolicyNotFoundException' in stderr, 'lifecycle metadata read failed')
            return None
        return json.loads(json.loads(result.stdout)['lifecyclePolicyText'])

    def add(self, digest, size):
        require(DIGEST.fullmatch(digest) and type(size) is int and 0 <= size <= 64 * 1024**3, 'invalid content descriptor')
        require(digest not in self.parts or self.parts[digest] == size, 'conflicting content sizes')
        self.parts[digest] = size

    def graph(self, repository, digest, depth=0):
        require(DIGEST.fullmatch(digest) and depth <= 4, 'invalid manifest graph')
        if digest in self.visited:
            return
        require(len(self.visited) < 64, 'manifest graph exceeds review bound')
        self.visited.add(digest)
        raw = self.call(['skopeo', 'inspect', '--raw', '--authfile', self.auth_file, 'docker://' + repository + '@' + digest])
        require(len(raw) <= 1024**2, 'manifest metadata exceeds review bound')
        # Some CLI versions append a newline to --raw output.
        matching = next((body for body in [raw, raw.rstrip(b'\n')] if 'sha256:' + hashlib.sha256(body).hexdigest() == digest), None)
        require(matching is not None, 'source manifest digest mismatch')
        data = json.loads(matching)
        require(data.get('schemaVersion') == 2, 'unsupported image schema')
        self.add(digest, len(matching))
        if data.get('mediaType') in ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json']:
            require(0 < len(data.get('manifests', [])) <= 32, 'invalid image index')
            for child in data['manifests']:
                self.graph(repository, child['digest'], depth + 1)
        else:
            require(data.get('mediaType') in ['application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'], 'unsupported manifest type')
            require(len(data.get('layers', [])) <= 256, 'too many image layers')
            for descriptor in [data['config'], *data['layers']]:
                self.add(descriptor['digest'], descriptor['size'])

    def measure(self, digest):
        self.graph(self.selected['source'], digest)
        config = json.loads(self.call(['skopeo', '--override-os', 'linux', '--override-arch', 'amd64', 'inspect', '--config', '--authfile', self.auth_file,
                                      'docker://' + self.selected['source'] + '@' + digest]))
        require(config.get('os') == 'linux' and config.get('architecture') == 'amd64', 'image is not Linux/amd64')
        return sum(self.parts.values())

    def publish(self, digest):
        selected = self.selected
        identity = self.aws('sts', 'get-caller-identity')
        require(identity.get('Account') == ACCOUNT and identity.get('Arn', '').startswith('arn:aws:sts::' + ACCOUNT + ':assumed-role/' + selected['role'] + '/'), 'wrong publisher identity')
        repositories = self.aws('ecr', 'describe-repositories', '--repository-names', selected['repository']).get('repositories', [])
        destination = REGISTRY + '/' + selected['repository']
        require(len(repositories) == 1 and repositories[0].get('repositoryUri') == destination and
                repositories[0].get('imageTagMutability') == 'IMMUTABLE' and repositories[0].get('encryptionConfiguration', {}).get('encryptionType') == 'AES256', 'unreviewed destination repository')
        images = self.aws('ecr', 'describe-images', '--repository-name', selected['repository']).get('imageDetails', [])
        require(len(images) <= 32, 'repository metadata exceeds review bound')
        roots = set()
        for image in images:
            require(DIGEST.fullmatch(image['imageDigest']), 'invalid destination digest')
            for tag in image.get('imageTags', []):
                require(tag == 'sha256-' + image['imageDigest'][7:], 'foreign repository tag requires operator review')
                roots.add(image['imageDigest'])
        require(digest in roots or len(roots) < 2, 'two retained release digests already occupy this repository; operator cleanup required')
        lifecycle = self.lifecycle()
        if lifecycle is not None:
            verify_lifecycle(lifecycle, ['sha256-' + d[7:] for d in roots | {digest}])
        for image in images:
            self.graph(destination, image['imageDigest'])
        projected = sum(self.parts.values())
        require(projected <= selected['budget'], 'repository storage admission budget exceeded')
        require(len(self.visited) <= self.max_manifests, 'five-image retention target exceeded; review protected-reference exception')
        if digest not in roots:
            with tempfile.TemporaryDirectory() as directory:
                result_file = Path(directory) / 'digest'
                self.call(['skopeo', 'copy', '--all', '--preserve-digests', '--quiet', '--retry-times', '0', '--authfile', self.auth_file,
                           '--digestfile', str(result_file), 'docker://' + selected['source'] + '@' + digest,
                           'docker://' + destination + ':sha256-' + digest[7:]])
                require(result_file.read_text().strip() == digest, 'copied digest differs from release identity')
        observed = self.aws('ecr', 'describe-images', '--repository-name', selected['repository'], '--image-ids', 'imageDigest=' + digest).get('imageDetails', [])
        require(len(observed) == 1 and observed[0].get('imageDigest') == digest, 'destination digest was not verified')
        return {'destination': destination + '@' + digest, 'verifiedDestinationDigest': digest,
                'projectedUniqueBytes': projected, 'repositoryAdmissionBytes': selected['budget'], 'retainedReleaseDigests': len(roots | {digest}),
                'manifestCount': len(self.visited), 'manifestTarget': 5, 'approvedManifestLimit': self.max_manifests,
                'lifecycleInstalled': lifecycle is not None, 'retentionApplyPending': lifecycle is None}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind', choices=KINDS, required=True)
    parser.add_argument('--run-metadata', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--auth-file', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--publish', action='store_true', help='Requires exact operator approval; otherwise metadata only')
    parser.add_argument('--max-manifests', type=int, choices=range(5,11), default=5, help='Five by default; higher limits require explicit reference-preservation exception approval')
    args = parser.parse_args()
    try:
        auth_stat = args.auth_file.lstat()
        require(stat.S_ISREG(auth_stat.st_mode) and auth_stat.st_mode & 0o077 == 0 and auth_stat.st_uid == os.geteuid(), 'registry auth file must be private and owned by the executing user')
        run = json.loads(args.run_metadata.read_text())
        sha, digest = evidence_identity(args.kind, json.loads(args.evidence.read_text()), run)
        mirror = Mirror(args.kind, args.auth_file, max_manifests=args.max_manifests)
        size = mirror.measure(digest)
        receipt = {'schemaVersion': 1, 'kind': args.kind, 'sourceSha': sha, 'sourceRunId': run['id'], 'sourceRunAttempt': run['run_attempt'],
                   'source': KINDS[args.kind]['source'] + '@' + digest, 'sourceDigest': digest,
                   'evidenceSha256': hashlib.sha256(args.evidence.read_bytes()).hexdigest(), 'sourceUniqueBytes': size, 'sourceManifestCount': len(mirror.visited),
                   'sourceExceedsStorageBudget': size > KINDS[args.kind]['budget'], 'needsRetentionException': len(mirror.visited) > 5, 'published': args.publish}
        if args.publish:
            receipt.update(mirror.publish(digest))
        with args.output.open('x') as output:
            output.write(json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt))
    except Rejected as error:
        raise SystemExit('Staging image operation rejected: ' + str(error))
    except Exception:
        raise SystemExit('Staging image operation rejected; no credential-bearing diagnostics or success receipt emitted.')

if __name__ == '__main__':
    main()
