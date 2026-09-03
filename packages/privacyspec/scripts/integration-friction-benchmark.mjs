import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = resolve(scriptDirectory, "../fixtures/integration-friction");
const manifestPath = join(fixtureRoot, "manifest.json");

const listFiles = async (directory, root = directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path, root)));
    else if (entry.isFile()) files.push(relative(root, path));
  }
  return files.sort();
};

const nonBlankLines = (value) => value.split(/\r?\n/u).filter((line) => line.trim().length > 0);

const addedNonBlankLineCount = (before, after) => {
  const left = nonBlankLines(before);
  const right = nonBlankLines(after);
  const previous = new Uint16Array(right.length + 1);
  const current = new Uint16Array(right.length + 1);
  for (const leftLine of left) {
    current.fill(0);
    for (let index = 1; index <= right.length; index += 1) {
      current[index] =
        leftLine === right[index - 1]
          ? previous[index - 1] + 1
          : Math.max(previous[index], current[index - 1]);
    }
    previous.set(current);
  }
  return right.length - previous[right.length];
};

const stripImports = (value) =>
  value
    .split(/\r?\n/u)
    .filter((line) => !/^\s*import\s/u.test(line))
    .join("\n")
    .trim();

const environmentVariables = (value) =>
  new Set(Array.from(value.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/gu), (match) => match[1]));

const setDifferenceSize = (left, right) => {
  let count = 0;
  for (const value of left) if (!right.has(value)) count += 1;
  return count;
};

const addedScriptCount = (beforeFiles, afterFiles) => {
  let count = 0;
  for (const [path, after] of afterFiles) {
    if (!path.endsWith("package.json")) continue;
    const before = beforeFiles.get(path);
    const beforeScripts = before === undefined ? {} : (JSON.parse(before).scripts ?? {});
    const afterScripts = JSON.parse(after).scripts ?? {};
    for (const [name, command] of Object.entries(afterScripts)) {
      if (beforeScripts[name] !== command) count += 1;
    }
  }
  return count;
};

const readTree = async (directory) => {
  const paths = await listFiles(directory);
  return new Map(
    await Promise.all(
      paths.map(async (path) => [path, await readFile(join(directory, path), "utf8")]),
    ),
  );
};

export const measureIntegrationFrictionScenario = async (definition) => {
  const directory = join(fixtureRoot, definition.id);
  const beforeFiles = await readTree(join(directory, "before"));
  const afterFiles = await readTree(join(directory, "after"));
  const commonFiles = Array.from(afterFiles.keys()).filter((path) => beforeFiles.has(path));
  const changedFiles = commonFiles.filter((path) => beforeFiles.get(path) !== afterFiles.get(path));
  const addedFiles = Array.from(afterFiles.keys()).filter((path) => !beforeFiles.has(path));
  const removedFiles = Array.from(beforeFiles.keys()).filter((path) => !afterFiles.has(path));
  const specFiles = commonFiles.filter((path) =>
    /(?:^|\/)(?:[^/]+\.)?(?:spec|setup)\.[cm]?[jt]s$/u.test(path),
  );
  const testBodiesChanged = specFiles.filter(
    (path) => stripImports(beforeFiles.get(path)) !== stripImports(afterFiles.get(path)),
  ).length;
  const privacySpecAssertions = specFiles.reduce((count, path) => {
    const body = stripImports(afterFiles.get(path));
    return (
      count +
      body
        .split(/\r?\n/u)
        .filter((line) =>
          /(?:expect|assert).*privacyspec|privacyspec.*(?:expect|assert)|withPrivacySpec\s*\(/iu.test(
            line,
          ),
        ).length
    );
  }, 0);
  const beforeText = Array.from(beforeFiles.values()).join("\n");
  const afterText = Array.from(afterFiles.values()).join("\n");
  const addedCommands = addedScriptCount(beforeFiles, afterFiles);
  const proxyOrCertificateSettings = changedFiles.reduce((count, path) => {
    const after = afterFiles.get(path);
    const before = beforeFiles.get(path);
    const addedLines = nonBlankLines(after).filter(
      (line) =>
        /\b(?:proxy|clientCertificates|certificateAuthority|ignoreHTTPSErrors)\b/u.test(line) &&
        !nonBlankLines(before).includes(line),
    );
    return count + addedLines.length;
  }, 0);

  return {
    id: definition.id,
    title: definition.title,
    supportedHappyPath: definition.supportedHappyPath,
    metrics: {
      existingFilesTouched: changedFiles.length,
      filesAdded: addedFiles.length,
      filesRemoved: removedFiles.length,
      nonBlankIntegrationLines: [...changedFiles, ...addedFiles].reduce(
        (count, path) =>
          count + addedNonBlankLineCount(beforeFiles.get(path) ?? "", afterFiles.get(path)),
        0,
      ),
      testFilesImportRouteChanged: specFiles.filter(
        (path) => beforeFiles.get(path) !== afterFiles.get(path),
      ).length,
      testBodiesChanged,
      privacySpecAssertions,
      commandsAdded: addedCommands,
      newProcesses: addedCommands,
      environmentVariablesAdded: setDifferenceSize(
        environmentVariables(afterText),
        environmentVariables(beforeText),
      ),
      proxyOrCertificateSettings,
      timeToFirstReportMilliseconds: null,
    },
    expectedCoverage: definition.expectedCoverage,
    expectedReasonCode: definition.expectedReasonCode,
    behaviorEvidence: definition.behaviorEvidence,
  };
};

export const measureIntegrationFriction = async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return {
    benchmarkSchemaVersion: manifest.benchmarkSchemaVersion,
    archetypes: await Promise.all(
      manifest.archetypes.map((definition) => measureIntegrationFrictionScenario(definition)),
    ),
  };
};

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await measureIntegrationFriction(), null, 2)}\n`);
}
