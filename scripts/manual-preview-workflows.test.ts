import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Step = {
  id?: string;
  name?: string;
  run?: string;
  env?: Record<string, string>;
  with?: { script?: string };
};
type Workflow = { jobs: Record<string, { steps: Step[] }> };

const cleanup = Bun.YAML.parse(readFileSync('.github/workflows/cleanup-pr.yml', 'utf8')) as Workflow;
const build = Bun.YAML.parse(readFileSync('.github/workflows/build-pr.yml', 'utf8')) as Workflow;

function step(workflow: Workflow, job: string, name: string): Step {
  const found = workflow.jobs[job].steps.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing ${job} step: ${name}`);
  return found;
}

function runValidation(rawPrNumber: string) {
  const steps = cleanup.jobs['trigger-cleanup'].steps;
  const validate = step(cleanup, 'trigger-cleanup', 'Validate PR number');
  expect(steps.indexOf(validate)).toBeLessThan(steps.findIndex((candidate) => candidate.name === 'Generate GitHub App token'));
  expect(validate.env?.RAW_PR_NUMBER).toBe('${{ inputs.pr_number }}');
  expect(validate.run).not.toContain('${{ inputs.pr_number }}');

  const root = mkdtempSync(join(tmpdir(), 'cleanup-pr-validation-'));
  try {
    const output = join(root, 'output');
    writeFileSync(output, '');
    const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', validate.run!], {
      cwd: root,
      env: { ...process.env, RAW_PR_NUMBER: rawPrNumber, GITHUB_OUTPUT: output },
      encoding: 'utf8',
    });
    return { result, output: readFileSync(output, 'utf8') };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function runGithubScript(script: string, env: Record<string, string>) {
  const calls: Record<string, unknown>[] = [];
  const outputs: Record<string, string> = {};
  let failure: string | undefined;
  const github = {
    rest: { actions: { createWorkflowDispatch: async (args: Record<string, unknown>) => { calls.push(args); } } },
  };
  const core = {
    setOutput: (name: string, value: string) => { outputs[name] = value; },
    setFailed: (message: string) => { failure = message; },
    notice: (_message: string) => {},
  };
  const execute = new Function('github', 'context', 'core', 'process', `return (async () => {\n${script}\n})()`) as
    (github: typeof github, context: { eventName: string }, core: typeof core, process: { env: Record<string, string> }) => Promise<void>;
  await execute(github, { eventName: 'workflow_dispatch' }, core, { env });
  return { calls, outputs, failure };
}

test('manual cleanup rejects injected PR input before minting a token and preserves numeric PRs', () => {
  for (const [input, canonical] of [
    ['123', '123'],
    ['00123', '123'],
    ['9007199254740991', '9007199254740991'],
  ]) {
    const { result, output } = runValidation(input);
    expect(result.status).toBe(0);
    expect(output).toBe(`pr_number=${canonical}\n`);
  }
  for (const input of ['', '0', '-1', '1.5', '9007199254740992', "123' + process.exit(1) + '", '123$(printf INJECTED)']) {
    const { result, output } = runValidation(input);
    expect(result.status).not.toBe(0);
    expect(output).toBe('');
  }
});

test('cleanup dispatch treats validated inputs as data in github-script', async () => {
  const dispatch = step(cleanup, 'trigger-cleanup', 'Trigger ephemeral cleanup');
  expect(dispatch.env?.PR_NUMBER).toBe('${{ steps.validate.outputs.pr_number }}');
  expect(dispatch.with?.script).not.toContain('${{');
  const { calls, failure } = await runGithubScript(dispatch.with!.script!, {
    PR_NUMBER: '123', SOURCE_REPO: '0xFlicker/influence-game',
  });
  expect(failure).toBeUndefined();
  expect(calls).toEqual([{
    owner: '0xFlicker', repo: 'linode-iac', workflow_id: 'cleanup-ephemeral.yml', ref: 'main',
    inputs: { pr_number: '123', source_repo: '0xFlicker/influence-game' },
  }]);
});

test('manual Build PR rejects injected PR input while passing old SHAs through unchanged', async () => {
  const status = step(build, 'ephemeral-status', 'Determine ephemeral redeploy eligibility');
  const oldSha = '0123456789abcdef0123456789abcdef01234567';
  for (const ref of [oldSha, 'release/rollback-2026-11-05', 'v0.8.0']) {
    const valid = await runGithubScript(status.with!.script!, {
      INPUT_PR_NUMBER: '00123', INPUT_HEAD_SHA: ref,
    });
    expect(valid.failure).toBeUndefined();
    expect(valid.outputs).toEqual({ should_deploy: 'true', pr_number: '123', head_sha: ref });
  }
  for (const input of ['0', '-1', '1.5', '9007199254740992', '123$(printf INJECTED)', "123' + process.exit(1) + '"]) {
    const rejected = await runGithubScript(status.with!.script!, {
      INPUT_PR_NUMBER: input, INPUT_HEAD_SHA: oldSha,
    });
    expect(rejected.failure).toContain('PR number');
    expect(rejected.outputs.should_deploy).toBeUndefined();
  }
  for (const job of ['check', 'docker-build-push']) {
    const checkout = build.jobs[job].steps.find((candidate) => candidate.with && 'ref' in candidate.with);
    expect(checkout?.with).toHaveProperty('ref', '${{ needs.ephemeral-status.outputs.head_sha }}');
  }
});

test('Build PR quotes manual inputs in the real build script without invoking Docker', () => {
  const buildStep = step(build, 'docker-build-push', 'Build and push ${{ matrix.target }}');
  expect(buildStep.env?.PR_NUMBER).toBe('${{ needs.ephemeral-status.outputs.pr_number }}');
  expect(buildStep.env?.HEAD_SHA).toBe('${{ needs.ephemeral-status.outputs.head_sha }}');
  expect(buildStep.run).not.toContain('${{ needs.ephemeral-status.outputs.pr_number }}');
  expect(buildStep.run).not.toContain('${{ needs.ephemeral-status.outputs.head_sha }}');

  const root = mkdtempSync(join(tmpdir(), 'build-pr-shell-'));
  try {
    const docker = join(root, 'docker');
    const trace = join(root, 'docker-args');
    const marker = join(root, 'injected');
    writeFileSync(docker, '#!/bin/sh\nprintf "CALL\\n" >> "$TRACE_FILE"\nfor arg in "$@"; do printf "<%s>\\n" "$arg" >> "$TRACE_FILE"; done\n');
    chmodSync(docker, 0o755);
    const shell = buildStep.run!
      .replaceAll('${{ matrix.image }}', 'ghcr.io/0xflicker/influence-web')
      .replaceAll('${{ matrix.dockerfile }}', 'Dockerfile.web')
      .replaceAll('${{ matrix.build_args }}', '')
      .replaceAll('${{ matrix.target }}', 'web');
    const runBuild = (prNumber: string, headSha: string) => {
      writeFileSync(trace, '');
      const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', shell], {
        cwd: root,
        env: { ...process.env, PATH: `${root}:${process.env.PATH}`, TRACE_FILE: trace, PR_NUMBER: prNumber, HEAD_SHA: headSha },
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      const args = readFileSync(trace, 'utf8');
      expect(args).toContain(`<GIT_SHA=${headSha}>`);
      expect(args).toContain(`<ghcr.io/0xflicker/influence-web:pr-${prNumber}>`);
      expect(args).toContain('CALL\n<push>');
    };
    runBuild('123', '0123456789abcdef0123456789abcdef01234567');
    runBuild(`123$(touch ${marker})`, `0123456789abcdef$(touch ${marker})`);
    expect(existsSync(marker)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Build PR deploy dispatch uses validated PR data and all inline Bash parses', async () => {
  const deploy = step(build, 'trigger-deploy', 'Trigger ephemeral deploy');
  expect(deploy.with?.script).not.toContain('${{');
  const { calls } = await runGithubScript(deploy.with!.script!, {
    PR_NUMBER: '123', SOURCE_REPO: '0xFlicker/influence-game',
  });
  expect(calls).toEqual([{
    owner: '0xFlicker', repo: 'linode-iac', workflow_id: 'deploy-ephemeral.yml', ref: 'main',
    inputs: { pr_number: '123', image_tag: 'pr-123', source_repo: '0xFlicker/influence-game' },
  }]);
  for (const workflow of [cleanup, build]) for (const job of Object.values(workflow.jobs)) for (const candidate of job.steps) {
    if (!candidate.run) continue;
    const parsed = spawnSync('bash', ['-n'], {
      input: candidate.run.replace(/\$\{\{[\s\S]*?\}\}/g, 'VALUE'), encoding: 'utf8',
    });
    expect(parsed.status).toBe(0);
  }
});
