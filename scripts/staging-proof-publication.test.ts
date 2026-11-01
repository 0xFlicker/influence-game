import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
type Step = { name?: string; run?: string; env?: Record<string, string> };
type Workflow = { jobs: Record<string, { if: string; needs: string[]; steps: Step[]; strategy: { matrix: { include: { target: string }[] } } }> };
const ci = Bun.YAML.parse(readFileSync('.github/workflows/ci.yml', 'utf8')) as Workflow;
const mirror = Bun.YAML.parse(readFileSync('.github/workflows/staging-renderer-ecr.yml', 'utf8')) as Workflow;
function allowed(job: string, event: string, ref: string, proof = false, actor = '97764360', repo = '1183905474') {
  // Evaluate the checked workflow's actual guard for representative requests.
  return Boolean(new Function('github', 'inputs', 'needs', 'startsWith', `return (${ci.jobs[job].if.replaceAll('needs.release-scope', 'needs["release-scope"]')});`)(
    { event_name: event, ref, repository_id: repo, actor_id: actor }, { proof_publication: proof },
    { 'release-scope': { outputs: { release_required: 'true' } } }, (value: string, prefix: string) => value.startsWith(prefix)));
}
test('proof publication builds all three images but can never dispatch ordinary staging', () => {
  for (const job of ['docker-build-push', 'release-manifest']) {
    expect(allowed(job, 'push', 'refs/heads/main')).toBe(true);
    expect(allowed(job, 'workflow_dispatch', 'refs/heads/main')).toBe(true);
    expect(allowed(job, 'workflow_dispatch', 'refs/heads/proof/staging-render-one', true)).toBe(true);
    for (const [event, ref, proof, actor, repo] of [
      ['workflow_dispatch', 'refs/heads/main', true, '97764360', '1183905474'],
      ['pull_request', 'refs/heads/proof/staging-render-one', true, '97764360', '1183905474'],
      ['workflow_dispatch', 'refs/heads/feature/other', true, '97764360', '1183905474'],
      ['workflow_dispatch', 'refs/heads/proof/staging-render-one', true, 'other', '1183905474'],
      ['workflow_dispatch', 'refs/heads/proof/staging-render-one', true, '97764360', 'other'],
    ] as const) expect(allowed(job, event, ref, proof, actor, repo)).toBe(false);
  }
  expect(ci.jobs['trigger-deploy']).toBeUndefined();
  expect(ci.jobs['docker-build-push'].strategy.matrix.include.map((x) => x.target).sort()).toEqual(['api', 'render-worker', 'web']);
  expect(ci.jobs['release-manifest'].needs).toEqual(['check', 'provider-free', 'api-postgres', 'docker-build-push']);
  const build = ci.jobs['docker-build-push'].steps.find((x) => x.name === 'Build and push ${{ matrix.target }}')!;
  expect(build.run!).toContain('if [ "$PROOF_PUBLICATION" != true ]; then\n            docker push'.replaceAll('            ', '  '));
  expect(build.env!.POSTHOG_PERSONAL_API_KEY).toContain('!inputs.proof_publication');
});
test('workflow shell scripts parse and mirror verifies proof commit independently before credentials', () => {
  for (const workflow of [ci, mirror]) for (const job of Object.values(workflow.jobs)) for (const step of job.steps ?? []) {
    if (step.run) expect(spawnSync('bash', ['-n'], { input: step.run.replace(/\$\{\{[\s\S]*?\}\}/g, 'VALUE'), encoding: 'utf8' }).status).toBe(0);
  }
  const steps = mirror.jobs.mirror.steps;
  const verify = steps.findIndex((s) => s.name === 'Verify source run before downloading release evidence');
  const auth = steps.findIndex((s) => s.name === "Authenticate only to this repository's existing GHCR package");
  expect(steps[verify].run!).toContain('staging-proof-source.py --run-metadata source-run.json');
  expect(verify).toBeLessThan(auth);
});
test('proof web packaging removes unuploaded maps and preserves chunks and the release assertion', () => {
  const root = mkdtempSync(join(tmpdir(), 'proof-web-packaging-'));
  try {
    const output = join(root, 'Dockerfile');
    const source = readFileSync('Dockerfile.web', 'utf8');
    const assertion = `RUN test -z "$(find .next/static -name '*.map' -print -quit)"`;
    const cleanup = `RUN find .next/static -type f -name '*.map' -delete\n`;
    const generate = (input: string) => spawnSync('python3', ['scripts/staging-proof-web-dockerfile.py', '--source', input, '--output', output], { encoding: 'utf8' });
    expect(generate('Dockerfile.web').status).toBe(0);
    const derived = readFileSync(output, 'utf8');
    expect(derived).toBe(source.replace(assertion, cleanup + assertion));
    mkdirSync(join(root, '.next/static/chunks'), { recursive: true });
    writeFileSync(join(root, '.next/static/chunks/page.js'), 'chunk');
    writeFileSync(join(root, '.next/static/chunks/page.js.map'), 'private map');
    const commands = derived.slice(derived.indexOf(cleanup), derived.indexOf(assertion) + assertion.length)
      .split('\n').map(line => line.replace(/^RUN /, '')).join('\n');
    expect(spawnSync('sh', ['-ec', commands], { cwd: root }).status).toBe(0);
    expect(readFileSync(join(root, '.next/static/chunks/page.js'), 'utf8')).toBe('chunk');
    const invalid = join(root, 'invalid');
    for (const content of [source.replace(assertion, ''), source + '\n' + assertion]) {
      writeFileSync(invalid, content); expect(generate(invalid).status).not.toBe(0);
    }
    const build = ci.jobs['docker-build-push'].steps.find(step => step.name === 'Build and push ${{ matrix.target }}')!.run!;
    expect(build).toContain('if [ "$PROOF_PUBLICATION" = true ] && [ "${{ matrix.target }}" = web ]; then');
    expect(build).toContain('docker build -f "$dockerfile"');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('actual release-scope command excludes only the policy test, while policy edits still require release', () => {
  const root = mkdtempSync(join(tmpdir(), 'proof-release-scope-'));
  const run = (command: string, args: string[], env = process.env) => {
    const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8' });
    expect(result.status).toBe(0); return result.stdout.trim();
  };
  try {
    run('git', ['init', '--quiet']);
    mkdirSync(join(root, 'deployment'), { recursive: true });
    mkdirSync(join(root, 'packages/engine/src/__tests__'), { recursive: true });
    const testFile = join(root, 'packages/engine/src/__tests__/render-execution-config.test.ts');
    const policyFile = join(root, 'deployment/render-execution.json');
    writeFileSync(testFile, 'first'); writeFileSync(policyFile, 'local');
    const commit = () => { run('git', ['add', '.']); run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--quiet', '-m', 'fixture']); return run('git', ['rev-parse', 'HEAD']); };
    let base = commit();
    const scope = ci.jobs['release-scope'].steps.find(s => s.name === 'Detect release image input changes')!.run!;
    for (const [file, content, expected] of [[testFile, 'second', 'false'], [policyFile, 'remote', 'true']] as const) {
      writeFileSync(file, content); const head = commit(); const output = join(root, 'output');
      writeFileSync(output, ''); run('bash', ['-c', scope], { ...process.env, GITHUB_EVENT_NAME: 'push', GITHUB_SHA: head, BASE_SHA: base, PROOF_PUBLICATION: 'false', GITHUB_OUTPUT: output });
      expect(readFileSync(output, 'utf8').trim()).toBe(`release_required=${expected}`); base = head;
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('ordinary staging activates only after successful source CI and verified mirror', () => {
  const release = Bun.YAML.parse(readFileSync('.github/workflows/staging-release.yml', 'utf8'));
  expect(release.on.workflow_run).toEqual({ workflows: ['CI'], types: ['completed'], branches: ['main'] });
  const guard = release.jobs.release.if;
  const source = { conclusion: 'success', head_branch: 'main', head_repository: { id: 1183905474 } };
  const allowedRelease = (workflowRun: typeof source, repo = '1183905474') => Boolean(new Function('github', `return (${guard});`)({
    repository_id: repo, repository_owner_id: '97764360', event: { workflow_run: workflowRun },
  }));
  expect(allowedRelease(source)).toBe(true);
  expect(allowedRelease({ ...source, conclusion: 'failure' })).toBe(false);
  expect(allowedRelease({ ...source, head_branch: 'proof/staging-render-one' })).toBe(false);
  expect(allowedRelease({ ...source, head_repository: { id: 1 } })).toBe(false);
  expect(allowedRelease(source, 'fork')).toBe(false);
  expect(release.jobs.mirror.needs).toBe('release');
  expect(release.jobs['trigger-deploy'].needs).toEqual(['release', 'mirror']);
  expect(release.jobs['trigger-deploy'].if).not.toContain('always()');
  expect(release.jobs.mirror.uses).toBe('./.github/workflows/staging-renderer-ecr.yml');
  expect(release.jobs.mirror.permissions['id-token']).toBe('write');
  const trigger = release.jobs['trigger-deploy'].steps.find((step: Step) => step.name === 'Trigger staging only after mirror admission succeeds').with.script;
  expect(trigger).toContain('build_run_id: process.env.BUILD_RUN_ID');
  expect(trigger).toContain('build_run_attempt: process.env.BUILD_RUN_ATTEMPT');
  expect(trigger).toContain('worker_mirror_receipt_digest: process.env.WORKER_MIRROR_RECEIPT_DIGEST');
  expect(JSON.stringify(release.jobs['trigger-deploy'].env)).not.toContain('github.run_id');
  expect(JSON.stringify(release.jobs.release.steps)).not.toContain('workflow_run.head_sha');
  expect(ci.jobs['trigger-deploy']).toBeUndefined();
});
