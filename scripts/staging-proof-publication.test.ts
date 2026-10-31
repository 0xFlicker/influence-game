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
  expect(allowed('trigger-deploy', 'workflow_dispatch', 'refs/heads/proof/staging-render-one', true)).toBe(false);
  expect(allowed('trigger-deploy', 'workflow_dispatch', 'refs/heads/main', true)).toBe(false);
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
