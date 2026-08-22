import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { chromium } from "@playwright/test";

import { RuntimeFailureAnalyzer } from "../dist/analyzers/runtime-failure/analyzer.js";
import {
  createRuntimeFailureAttachment,
  parseRuntimeFailureAttachment,
  parseRuntimeFailureBaseline,
  parseRuntimeFailureLatestRun,
  parseRuntimeFailureReport,
} from "../dist/analyzers/runtime-failure/artifact.js";
import {
  compareRuntimeFailureBaseline,
  createRuntimeFailureBaselineEntries,
} from "../dist/analyzers/runtime-failure/baseline.js";
import { createResponseJsonCoverage } from "../dist/discovery/response-json.js";
import { ConsoleObserver } from "../dist/observe/console.js";
import { AnalyzerHost } from "../dist/runtime/analyzer.js";
import { createRuntimeCapabilityModel } from "../dist/runtime/capabilities.js";
import { RuntimeEventMetadataFactory } from "../dist/runtime/events.js";

const repetitions = 20;
const generatedAt = "2026-08-21T12:00:00.000Z";
const testMetadata = {
  testId: "runtime-stability-browser",
  file: "tests/runtime-stability.spec.ts",
  title: "navigation, reload, popup, and teardown remain stable",
  projectName: "chromium",
};

const requestPage = (request) => {
  try {
    return request.frame().page();
  } catch {
    return undefined;
  }
};

const requestFrameKind = (request) => {
  try {
    return request.frame().parentFrame() === null ? "main" : "child";
  } catch {
    return "unknown";
  }
};

const requestFailureCode = (request) => {
  const text = request.failure()?.errorText ?? "";
  return /\b(?:net::)?(ERR_[A-Z0-9_]{1,64})\b/u.exec(text.toUpperCase())?.[1] ?? "REQUEST_FAILED";
};

const semanticFinding = (finding) => ({
  identity: finding.identity,
  ruleId: finding.ruleId,
  severity: finding.severity,
  classification: finding.classification,
});

test("runtime identities stay stable across 20 browser navigation and teardown repetitions", async () => {
  const browser = await chromium.launch();
  const digests = new Set();
  const coverageStates = new Set();
  const identitySets = new Set();
  const findingSets = new Set();
  const integrationErrorSets = new Set();

  try {
    for (let iteration = 0; iteration < repetitions; iteration += 1) {
      const context = await browser.newContext();
      const analyzer = new RuntimeFailureAnalyzer({ origins: ["https://app.runtime.test"] });
      const host = new AnalyzerHost([analyzer]);
      const metadata = new RuntimeEventMetadataFactory({
        testId: testMetadata.testId,
        projectName: testMetadata.projectName,
      });
      let consoleEvents = 0;
      let networkEvents = 0;
      let navigationEvents = 0;
      const consoleObserver = new ConsoleObserver(
        {
          addConsole: (sink, message) => {
            consoleEvents += 1;
            host.emit({
              type: "console",
              meta: metadata.create({ context, page: message?.page(), timestamp: sink.timestamp }),
              sink,
            });
          },
          markLimitReached: () => {
            host.emit({
              type: "collector-limit",
              meta: metadata.create({ context }),
              collector: "console",
            });
          },
        },
        () => Date.now(),
      );
      const requestFailed = (request) => {
        networkEvents += 1;
        host.emit({
          type: "request-failed",
          meta: metadata.create({ context, page: requestPage(request) }),
          request: {
            url: request.url(),
            method: request.method(),
            resourceType: request.resourceType(),
            frameKind: requestFrameKind(request),
            timestamp: Date.now(),
          },
          failureCode: requestFailureCode(request),
        });
      };
      const contentHash = `AbCd${String(iteration).padStart(8, "0")}`;
      const syntheticAddress = [`browser-${iteration}`, "example.test"].join("@");
      const pageBody = (pathname) => `
        <main>${pathname}</main>
        <script>
          console.error(
            '\\nWidget ${iteration} failed for ${syntheticAddress} at 2026-08-21T12:13:14Z',
            { detail: 'structured-${iteration}' },
          );
          fetch('https://telemetry.runtime.test/collect/${iteration}', {
            method: 'POST',
            body: 'semantic-fixture',
          }).catch(() => undefined);
          globalThis.phase29Ready = true;
        </script>
        <script src="https://cdn.runtime.test/assets/app-${contentHash}.js"></script>
        <img src="https://cdn.runtime.test/assets/image-${contentHash}.png">
      `;

      try {
        await context.route("https://app.runtime.test/**", async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          await route.fulfill({ body: pageBody(pathname), contentType: "text/html" });
        });
        await context.route("https://telemetry.runtime.test/**", (route) => route.abort("aborted"));
        await context.route("https://cdn.runtime.test/**/*.js", (route) =>
          route.abort("connectionreset"),
        );
        await context.route("https://cdn.runtime.test/**/*.png", (route) => route.abort("aborted"));
        context.on("requestfailed", requestFailed);
        consoleObserver.attach(context);

        const page = await context.newPage();
        await page.goto(`https://app.runtime.test/start/${iteration}`, {
          waitUntil: "domcontentloaded",
        });
        navigationEvents += 1;
        await page.waitForFunction(() => globalThis.phase29Ready === true);
        await page.reload({ waitUntil: "domcontentloaded" });
        navigationEvents += 1;
        await page.waitForFunction(() => globalThis.phase29Ready === true);

        const popupPromise = page.waitForEvent("popup");
        await page.evaluate(
          (url) => window.open(url),
          `https://app.runtime.test/popup/${iteration}`,
        );
        const popup = await popupPromise;
        await popup.waitForLoadState("domcontentloaded");
        navigationEvents += 1;
        await popup.waitForFunction(() => globalThis.phase29Ready === true);

        await page.goto(`https://app.runtime.test/next/${iteration}`, {
          waitUntil: "domcontentloaded",
        });
        navigationEvents += 1;
        await page.waitForFunction(() => globalThis.phase29Ready === true);
        await popup.close();
        await page.close();

        consoleObserver.detach();
        context.off("requestfailed", requestFailed);
        await consoleObserver.flush();
        const capabilities = createRuntimeCapabilityModel({
          observation: {
            browserObjects: { seen: 1 },
            contexts: { seen: 1, instrumented: 1 },
            pages: { seen: 2, instrumented: 2, storageCapable: 2 },
            events: {
              navigations: navigationEvents,
              network: networkEvents,
              console: consoleEvents,
            },
          },
          responseJson: createResponseJsonCoverage(false),
          observerWorkFailed: false,
        });
        const finalized = await host.finalizeTest({ test: testMetadata, capabilities });
        const runtime = finalized.results.get("runtime-failure");
        assert.equal(runtime.coverage, "complete");
        const comparison = compareRuntimeFailureBaseline(runtime.inventory);
        const integrationErrors = [];

        const attachment = createRuntimeFailureAttachment(runtime, { failed: false });
        if (parseRuntimeFailureAttachment(structuredClone(attachment)) === undefined) {
          integrationErrors.push("attachment");
        }
        const entries = createRuntimeFailureBaselineEntries(runtime.inventory);
        const baseline = {
          schemaVersion: 1,
          createdAt: generatedAt,
          entries,
        };
        const latestRun = {
          schemaVersion: 1,
          createdAt: generatedAt,
          complete: true,
          entries,
        };
        const report = {
          schemaVersion: 1,
          generatedAt,
          complete: true,
          coverage: runtime.coverage,
          inventory: runtime.inventory,
          findings: comparison.findings,
          baseline: {
            exists: false,
            known: comparison.known.length,
            new: comparison.new.length,
            resolved: comparison.resolved.length,
          },
          diagnostics: runtime.diagnostics,
        };
        for (const [name, parse, value] of [
          ["baseline", parseRuntimeFailureBaseline, baseline],
          ["latest-run", parseRuntimeFailureLatestRun, latestRun],
          ["report", parseRuntimeFailureReport, report],
        ]) {
          try {
            parse(structuredClone(value));
          } catch {
            integrationErrors.push(name);
          }
        }

        const serializedArtifacts = JSON.stringify({ attachment, baseline, latestRun, report });
        for (const raw of [syntheticAddress, contentHash, `structured-${iteration}`]) {
          assert.equal(serializedArtifacts.includes(raw), false);
        }

        const identities = runtime.inventory.map((entry) => entry.key);
        const findings = comparison.findings.map(semanticFinding);
        const semantic = {
          coverage: runtime.coverage,
          identities,
          findings,
          integrationErrors,
        };
        const semanticHash = createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
        digests.add(semanticHash);
        coverageStates.add(runtime.coverage);
        identitySets.add(JSON.stringify(identities));
        findingSets.add(JSON.stringify(findings));
        integrationErrorSets.add(JSON.stringify(integrationErrors));

        assert.deepEqual(
          runtime.inventory.map((entry) => [
            entry.failureType,
            entry.failureCode,
            entry.method,
            entry.endpoint,
          ]),
          [
            ["console-error", null, null, null],
            ["request-failed", "ERR_CONNECTION_RESET", "GET", "/assets/app-:hash.js"],
            ["request-failed", "ERR_ABORTED", "POST", "/collect/:number"],
          ],
        );
      } finally {
        consoleObserver.detach();
        context.off("requestfailed", requestFailed);
        host.dispose();
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  assert.equal(digests.size, 1);
  assert.deepEqual(Array.from(coverageStates), ["complete"]);
  assert.equal(identitySets.size, 1);
  assert.equal(findingSets.size, 1);
  assert.deepEqual(Array.from(integrationErrorSets), ["[]"]);
});
