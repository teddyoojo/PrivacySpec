import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { cpus, platform, release } from "node:os";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const runCount = 5;
const resultUrl = new URL("../benchmark/phase-10-reporting.json", import.meta.url);
const baselineUrl = new URL("../benchmark/clean-baseline.json", import.meta.url);
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const rootManifest = JSON.parse(
  await readFile(new URL("../../../package.json", import.meta.url), "utf8"),
);
const demoManifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const packageManagerEntry = process.env.npm_execpath;
const command = packageManagerEntry ? process.execPath : "pnpm";
const buildArguments = [...(packageManagerEntry ? [packageManagerEntry] : []), "run", "build"];
const commandArguments = [
  ...(packageManagerEntry ? [packageManagerEntry] : []),
  "exec",
  "playwright",
  "test",
  "--project=chromium",
];

const leakFlags = [
  "DEMO_LEAK_EMAIL_TO_ANALYTICS",
  "DEMO_LEAK_PHONE_TO_ANALYTICS",
  "DEMO_LEAK_EMAIL_IN_URL",
  "DEMO_LEAK_EMAIL_LOCALSTORAGE",
  "DEMO_LEAK_EMAIL_CONSOLE",
  "DEMO_LEAK_PASSWORD_EXTERNAL",
  "DEMO_LEAK_HASHED_EMAIL_EXTERNAL",
  "DEMO_LEAK_HTTP_EXTERNAL",
  "DEMO_LEAK_RESPONSE_EMAIL_EXTERNAL",
];

const cleanEnvironment = { ...process.env };
for (const flag of leakFlags) {
  cleanEnvironment[flag] = "0";
}
cleanEnvironment.PLAYWRIGHT_HTML_OPEN = "never";

const runBuildPreflight = () =>
  new Promise((resolvePromise, reject) => {
    process.stdout.write("Building the demo before benchmark timing...\n");
    const child = spawn(command, buildArguments, {
      cwd: packageDirectory,
      env: cleanEnvironment,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (exitCode === 0) {
        resolvePromise();
        return;
      }

      const reason = signal === null ? `exit code ${exitCode}` : `signal ${signal}`;
      reject(new Error(`Demo build preflight failed with ${reason}.`));
    });
  });

const runPlaywright = (runNumber) =>
  new Promise((resolvePromise, reject) => {
    process.stdout.write(`\nPhase 10 reporting run ${runNumber}/${runCount}\n`);
    const startedAt = performance.now();
    const child = spawn(command, commandArguments, {
      cwd: packageDirectory,
      env: cleanEnvironment,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      const durationMilliseconds = Math.round(performance.now() - startedAt);
      if (exitCode === 0) {
        resolvePromise(durationMilliseconds);
        return;
      }

      const reason = signal === null ? `exit code ${exitCode}` : `signal ${signal}`;
      reject(new Error(`Playwright benchmark run ${runNumber} failed with ${reason}.`));
    });
  });

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};

const durationsMilliseconds = [];
await runBuildPreflight();
for (let runNumber = 1; runNumber <= runCount; runNumber += 1) {
  durationsMilliseconds.push(await runPlaywright(runNumber));
}

const baseline = JSON.parse(await readFile(baselineUrl, "utf8"));
const medianMilliseconds = median(durationsMilliseconds);
const overheadPercent = Number(
  (
    ((medianMilliseconds - baseline.medianMilliseconds) / baseline.medianMilliseconds) *
    100
  ).toFixed(2),
);

const cpuList = cpus();
const result = {
  schemaVersion: 1,
  benchmark: "phase-10-reporting-and-ci",
  recordedAt: new Date().toISOString(),
  command: "pnpm exec playwright test --project=chromium",
  runCount,
  allRunsPassed: true,
  durationsMilliseconds,
  medianMilliseconds,
  cleanMode: {
    intentionalLeakFlagsEnabled: 0,
    forcedDisabledFlagCount: leakFlags.length,
  },
  runtime: {
    node: process.version,
    packageManager: rootManifest.packageManager,
    playwright: demoManifest.devDependencies?.["@playwright/test"],
    platform: platform(),
    release: release(),
    architecture: process.arch,
    cpuModel: cpuList[0]?.model ?? "unknown",
    logicalCpuCount: cpuList.length,
  },
  comparison: {
    baselineBenchmark: baseline.benchmark,
    baselineMedianMilliseconds: baseline.medianMilliseconds,
    overheadPercent,
  },
};

await mkdir(dirname(fileURLToPath(resultUrl)), { recursive: true });
const durationToken = "__BENCHMARK_DURATIONS__";
const serializedResult = JSON.stringify(
  { ...result, durationsMilliseconds: durationToken },
  null,
  2,
).replace(`"${durationToken}"`, `[${durationsMilliseconds.join(", ")}]`);
await writeFile(resultUrl, `${serializedResult}\n`, "utf8");

process.stdout.write(
  `\nPhase 10 reporting and CI: median ${result.medianMilliseconds} ms over ${runCount} passing runs.\n` +
    `Measured overhead against Phase 2: ${result.comparison.overheadPercent}%\n` +
    "Sanitized result: apps/demo-saas/benchmark/phase-10-reporting.json\n",
);
