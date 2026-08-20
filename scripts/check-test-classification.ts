/**
 * Fail closed when a Bun or Playwright test has no owning execution lane.
 * Discovery within a lane remains Bun-native; this script only enforces the
 * structural suffix/location contract for suites that automatic discovery
 * must exclude from the required provider-free or PostgreSQL lanes.
 */

export type Lane =
  | "provider-free"
  | "api-postgres"
  | "browser-coverage"
  | "staging"
  | "real-clerk"
  | "live-provider"
  | "external-smoke";

interface BrowserSpecOwner {
  lanes: readonly Lane[];
  runners: readonly BrowserSpecRunner[];
}

interface BrowserSpecRunner {
  name: string;
  command: string;
}

const browserSpecs = new Map<string, BrowserSpecOwner>([
  ["e2e/public-player-identity.spec.ts", {
    lanes: ["browser-coverage"],
    runners: [{
      name: "test:e2e:identity",
      command: "PLAYWRIGHT_LOCAL_IDENTITY=1 bunx playwright test e2e/public-player-identity.spec.ts",
    }],
  }],
  ["e2e/format-aware-game-viewer.spec.ts", {
    lanes: ["browser-coverage"],
    runners: [{
      name: "test:e2e:format-viewer",
      command: "PLAYWRIGHT_FORMAT_VIEWER=1 bunx playwright test e2e/format-aware-game-viewer.spec.ts --retries=0",
    }],
  }],
  // One file contains two explicitly selected Playwright projects. The
  // deterministic project is automatic; the real-Clerk project is manual.
  ["e2e/layered-authentication.spec.ts", {
    lanes: ["browser-coverage", "real-clerk"],
    runners: [
      {
        name: "test:e2e:layered-auth",
        command: "PLAYWRIGHT_LAYERED_AUTH=deterministic bunx playwright test e2e/layered-authentication.spec.ts --project=layered-auth-deterministic",
      },
      {
        name: "test:e2e:layered-auth:clerk",
        command: "PLAYWRIGHT_LAYERED_AUTH=real-clerk bunx playwright test e2e/layered-authentication.spec.ts --project=layered-auth-real-clerk",
      },
    ],
  }],
  ["e2e/smoke.spec.ts", {
    lanes: ["staging"],
    runners: [{
      name: "test:e2e:staging",
      command: "STAGING_RELEASE_GATE=1 bunx playwright test e2e/smoke.spec.ts --retries=0",
    }],
  }],
]);
const BUN_TEST_FILE = /(?:^|\/)(?:[^/]+\.(?:test|spec)|[^/]+_(?:test|spec))\.(?:js|jsx|ts|tsx)$/;
const PLAYWRIGHT_TEST_FILE = /(?:^|\/)[^/]+\.(?:spec|test)\.(?:c|m)?(?:js|ts)x?$/;

if (import.meta.main) {
  const testFiles = await discoverTestFiles();
  const owned = new Map<Lane, string[]>();
  const rootPackage = await Bun.file("package.json").json() as {
    scripts?: Record<string, string>;
  };
  const errors = validateBrowserSpecRunners(rootPackage.scripts ?? {});

  for (const file of testFiles) {
    const lanes = classifyTestFile(file);
    if (lanes instanceof Error) {
      errors.push(lanes.message);
      continue;
    }
    for (const lane of lanes) {
      const files = owned.get(lane) ?? [];
      files.push(file);
      owned.set(lane, files);
    }
  }

  if (errors.length > 0) {
    console.error("Test classification failed:\n");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  for (const lane of [...owned.keys()].sort()) {
    console.log(`${lane}: ${owned.get(lane)!.length}`);
  }
  console.log(`classified: ${testFiles.length}`);
}

export function classifyTestFile(file: string): readonly Lane[] | Error {
  const browserOwner = browserSpecs.get(file);
  if (browserOwner) return browserOwner.lanes;
  if (file.startsWith("e2e/")) {
    return new Error(
      `${file} is a new Playwright spec; add an explicit deterministic, staging, or manual owner`,
    );
  }

  if (file.includes("live-provider")) {
    return file.includes(".live-provider.test.")
      ? ["live-provider"]
      : new Error(`${file} uses the reserved live-provider marker without the canonical .live-provider.test suffix`);
  }
  if (file.includes("external-smoke")) {
    return file.includes(".external-smoke.test.")
      ? ["external-smoke"]
      : new Error(`${file} uses the reserved external-smoke marker without the canonical .external-smoke.test suffix`);
  }

  if (file.startsWith("packages/api/src/e2e/")) {
    return file.includes(".e2e.test.")
      ? ["browser-coverage"]
      : new Error(
        `${file} is under API e2e but lacks .e2e.test or a manual-suite suffix`,
      );
  }
  if (file.startsWith("packages/api/")) return ["api-postgres"];
  if (
    file.startsWith("packages/engine/")
    || file.startsWith("packages/web/")
    || file.startsWith("packages/prompt-lab-protocol/")
    || file.startsWith("scripts/")
  ) {
    return ["provider-free"];
  }

  return new Error(`${file} is outside every automatic or opt-in test lane`);
}

export function validateBrowserSpecRunners(
  scripts: Record<string, string>,
): string[] {
  const errors: string[] = [];
  for (const [file, owner] of browserSpecs) {
    for (const runner of owner.runners) {
      const command = scripts[runner.name];
      if (!command) {
        errors.push(`${file} declares missing package runner ${runner.name}`);
      } else if (command !== runner.command) {
        errors.push(`${file} package runner ${runner.name} must be: ${runner.command}`);
      }
    }
  }
  return errors;
}

async function discoverTestFiles(): Promise<string[]> {
  const git = Bun.spawn(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(git.stdout).text(),
    new Response(git.stderr).text(),
    git.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Unable to discover repository tests: ${stderr.trim()}`);
  }
  const files: string[] = [];
  for (const file of stdout.split("\0")) {
    if (isRepositoryTestFile(file) && await Bun.file(file).exists()) files.push(file);
  }
  return files.sort();
}

export function isRepositoryTestFile(file: string): boolean {
  return BUN_TEST_FILE.test(file)
    || (file.startsWith("e2e/") && PLAYWRIGHT_TEST_FILE.test(file));
}
