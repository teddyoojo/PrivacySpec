import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  renderStorageStateScan,
  renderStorageStateScanMarkdown,
  renderStorageStateScanTerminal,
} from "../dist/testdata/storage-state-render.js";
import {
  MAX_STORAGE_STATE_FILE_BYTES,
  MAX_STORAGE_STATE_FILES,
  MAX_STORAGE_STATE_JSON_DEPTH,
  MAX_STORAGE_STATE_JSON_NODES,
  StorageStateScanError,
  scanStorageStateFiles,
} from "../dist/testdata/storage-state-scan.js";

const execFileAsync = promisify(execFile);

const temporaryDirectory = async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "privacyspec-storage-state-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
};

const sensitiveFixtureValues = () => ({
  email: ["phase18.person", "example.test"].join("@"),
  phone: ["+49", "30", "55501234"].join(" "),
  token: ["phase18", "credential", "material"].join("-"),
});

const storageState = ({ credential = true, personal = true } = {}) => {
  const values = sensitiveFixtureValues();
  return {
    cookies: credential
      ? [
          {
            name: ["auth", "session"].join("_"),
            value: values.token,
            domain: "app.example.test",
            path: "/",
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: "Lax",
          },
        ]
      : [],
    origins: [
      {
        origin: "https://app.example.test",
        localStorage: [
          ...(credential ? [{ name: ["access", "token"].join("_"), value: values.token }] : []),
          ...(personal
            ? [
                { name: "contact", value: values.email },
                { name: "telephone", value: values.phone },
              ]
            : []),
        ],
      },
    ],
  };
};

test("scanner distinguishes tracked, ignored, and untracked credential-bearing state", async (context) => {
  const directory = await temporaryDirectory(context);
  await execFileAsync("git", ["init", "--quiet"], { cwd: directory });
  await writeFile(join(directory, ".gitignore"), "ignored-state.json\n", "utf8");

  const trackedPath = join(directory, "tracked-state.json");
  const ignoredPath = join(directory, "ignored-state.json");
  const untrackedPath = join(directory, "untracked-state.json");
  await writeFile(trackedPath, JSON.stringify(storageState()), "utf8");
  await writeFile(ignoredPath, JSON.stringify(storageState()), "utf8");
  await writeFile(untrackedPath, JSON.stringify(storageState({ personal: false })), "utf8");
  await execFileAsync("git", ["add", ".gitignore", "tracked-state.json"], { cwd: directory });

  const scan = await scanStorageStateFiles([trackedPath, ignoredPath, untrackedPath]);
  assert.equal(scan.storageStateScanSchemaVersion, 1);
  assert.deepEqual(
    scan.files.map((file) => [file.repositoryStatus, file.findingStatus]),
    [
      ["TRACKED", "REVIEW_REQUIRED"],
      ["IGNORED", "INFORMATIONAL"],
      ["UNTRACKED", "REVIEW_REQUIRED"],
    ],
  );
  assert.deepEqual(scan.summary.repositoryStatus, {
    tracked: 1,
    ignored: 1,
    untracked: 1,
    gitUnavailable: 0,
  });
  assert.equal(scan.summary.credentialBearingFiles, 3);
  assert.equal(scan.summary.personalDataShapedFiles, 2);
  assert.equal(scan.files[0]?.credentialEvidence.credentialNamedCookieCount, 1);
  assert.equal(scan.files[0]?.credentialEvidence.httpOnlyCookieCount, 1);
  assert.equal(scan.files[0]?.credentialEvidence.credentialNamedLocalStorageEntryCount, 1);
  assert.deepEqual(scan.files[0]?.personalDataShapes, {
    emailValueCount: 1,
    phoneValueCount: 1,
  });

  const outputs = [
    renderStorageStateScanTerminal(scan),
    renderStorageStateScanMarkdown(scan),
    renderStorageStateScan(scan, "json"),
  ];
  assert.equal(renderStorageStateScan(scan, "terminal"), outputs[0]);
  assert.equal(renderStorageStateScan(scan, "markdown"), outputs[1]);
  assert.equal(renderStorageStateScan(scan, "json"), outputs[2]);
  for (const output of outputs) {
    for (const privateValue of [
      ...Object.values(sensitiveFixtureValues()),
      "auth_session",
      "access_token",
      "app.example.test",
      trackedPath,
      ignoredPath,
      untrackedPath,
    ]) {
      assert.doesNotMatch(
        output,
        new RegExp(privateValue.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
      );
    }
    assert.match(output, /REVIEW_REQUIRED/u);
    assert.match(output, /INFORMATIONAL/u);
    assert.match(output, /https:\/\/playwright\.dev\/docs\/auth/u);
  }
});

test("scanner reports Git-unavailable credential state for review without exposing its path", async (context) => {
  const directory = await temporaryDirectory(context);
  const privateName = ["phase18.person", "example.test.json"].join("@");
  const path = join(directory, privateName);
  await writeFile(path, JSON.stringify(storageState({ personal: false })), "utf8");

  const scan = await scanStorageStateFiles([path]);
  assert.equal(scan.files[0]?.repositoryStatus, "GIT_UNAVAILABLE");
  assert.equal(scan.files[0]?.findingStatus, "REVIEW_REQUIRED");
  assert.doesNotMatch(JSON.stringify(scan), /phase18\.person|example\.test/u);
});

test("scanner rejects symlinks, oversized files, and bounded-JSON violations", async (context) => {
  const directory = await temporaryDirectory(context);
  const targetPath = join(directory, "target.json");
  const symlinkPath = join(directory, "linked.json");
  await writeFile(targetPath, JSON.stringify(storageState()), "utf8");
  await symlink(targetPath, symlinkPath);
  await assert.rejects(
    scanStorageStateFiles([symlinkPath]),
    (error) => error instanceof StorageStateScanError && /symbolic link/u.test(error.message),
  );

  const linkedDirectory = join(directory, "linked-directory");
  await symlink(directory, linkedDirectory);
  await assert.rejects(
    scanStorageStateFiles([join(linkedDirectory, "target.json")]),
    (error) => error instanceof StorageStateScanError && /symbolic link/u.test(error.message),
  );

  const oversizedPath = join(directory, "oversized.json");
  await writeFile(oversizedPath, Buffer.alloc(MAX_STORAGE_STATE_FILE_BYTES + 1, 0x20));
  await assert.rejects(scanStorageStateFiles([oversizedPath]), /file-size limit/u);

  const deepPath = join(directory, "deep.json");
  let nested = null;
  for (let depth = 0; depth <= MAX_STORAGE_STATE_JSON_DEPTH; depth += 1) nested = { nested };
  await writeFile(
    deepPath,
    JSON.stringify({ ...storageState({ credential: false, personal: false }), extra: nested }),
    "utf8",
  );
  await assert.rejects(scanStorageStateFiles([deepPath]), /JSON depth limit/u);

  const nodesPath = join(directory, "nodes.json");
  await writeFile(
    nodesPath,
    JSON.stringify({
      ...storageState({ credential: false, personal: false }),
      extra: Array.from({ length: MAX_STORAGE_STATE_JSON_NODES }, () => null),
    }),
    "utf8",
  );
  await assert.rejects(scanStorageStateFiles([nodesPath]), /JSON node limit/u);
});

test("scanner requires explicit unique regular storage-state JSON inputs", async (context) => {
  const directory = await temporaryDirectory(context);
  const path = join(directory, "state.json");
  await writeFile(path, JSON.stringify(storageState()), "utf8");

  await assert.rejects(scanStorageStateFiles([]), /At least one/u);
  await assert.rejects(scanStorageStateFiles([path, path]), /only once/u);
  await assert.rejects(
    scanStorageStateFiles(
      Array.from({ length: MAX_STORAGE_STATE_FILES + 1 }, (_, index) =>
        join(directory, `${index}.json`),
      ),
    ),
    /at most 32/u,
  );
  await assert.rejects(scanStorageStateFiles([directory]), /not a regular file/u);

  const malformedPath = join(directory, "malformed.json");
  await writeFile(malformedPath, "not-json", "utf8");
  await assert.rejects(
    scanStorageStateFiles([malformedPath]),
    (error) =>
      error instanceof StorageStateScanError &&
      /input 1 is not valid JSON/u.test(error.message) &&
      !error.message.includes(malformedPath),
  );

  const unsupportedPath = join(directory, "unsupported.json");
  await writeFile(unsupportedPath, JSON.stringify({ cookies: [{}], origins: [] }), "utf8");
  await assert.rejects(scanStorageStateFiles([unsupportedPath]), /unsupported cookie entry/u);

  const unrelatedPath = join(directory, "unrequested.json");
  await writeFile(unrelatedPath, JSON.stringify(storageState()), "utf8");
  const scan = await scanStorageStateFiles([path]);
  assert.equal(scan.scope.explicitlySuppliedFiles, 1);
  assert.equal(scan.scope.scannedFiles, 1);
  assert.equal(scan.files.length, 1);
  assert.doesNotMatch(JSON.stringify(scan), /unrequested/u);
});
