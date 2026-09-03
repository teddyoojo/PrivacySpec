import { compareCanonicalStrings } from "../canonical-order.js";
import type { Finding } from "../rules/model.js";
import type { PrivacySpecJsonReportV5, ReportFinding, SecondaryAnalysisStatus } from "./model.js";

export type SecondaryCoverageSummaryFormat = "terminal" | "markdown";

export const MAX_SECONDARY_COVERAGE_MARKDOWN_BYTES = 64 * 1024;
export const MAX_SECONDARY_COVERAGE_ITEMS_PER_MODULE = 5;
export const MAX_SECONDARY_COVERAGE_DIAGNOSTICS = 5;
export const MAX_SECONDARY_COVERAGE_TERMINAL_ITEMS = 5;

const statusLabel = (status: SecondaryAnalysisStatus): string => status.toUpperCase();

const playwrightStatusLabel = (
  status: PrivacySpecJsonReportV5["run"]["playwrightStatus"],
): string => {
  if (status === "passed") return "PASS";
  if (status === "failed") return "FAIL";
  if (status === "timedout") return "TIMED_OUT";
  return "INTERRUPTED";
};

const coverageLabel = (coverage: string): string => coverage.toUpperCase();

const boundedTerminalText = (value: string): string => {
  const safe = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined &&
      (codePoint < 32 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069))
      ? "�"
      : character;
  });
  return safe.length <= 256 ? safe.join("") : `${safe.slice(0, 255).join("")}…`;
};

interface TerminalActionableItem {
  key: string;
  line: string;
  priority: number;
}

const terminalFlowDestination = (finding: Finding): string => {
  const flow = finding.flow;
  return [flow.recipient?.origin, flow.endpoint, flow.location]
    .filter((value): value is string => value !== undefined)
    .map(boundedTerminalText)
    .join(" · ");
};

const actionableTerminalItems = (report: PrivacySpecJsonReportV5): TerminalActionableItem[] => {
  const items: TerminalActionableItem[] = [];
  for (const finding of actionablePrivacyFindings(report.findings)) {
    const destination = terminalFlowDestination(finding);
    const technical = finding.classification === "technical_failure";
    const externalReview = !technical && finding.flow.recipient?.firstParty === false;
    items.push({
      priority: technical ? 0 : externalReview ? 3 : 4,
      key: `privacy:${privacyFindingKey(finding)}`,
      line: `${technical ? `TECHNICAL_FAILURE ${finding.ruleId}` : externalReview ? "NEW external recipient" : `NEW privacy observation ${finding.ruleId}`}: ${boundedTerminalText(finding.flow.dataCategory)} → ${boundedTerminalText(finding.flow.sinkKind)}${destination.length > 0 ? ` · ${destination}` : ""}`,
    });
  }
  for (const finding of report.analysis.runtimeErrors.findings) {
    const target = [
      finding.method,
      finding.host,
      finding.endpoint,
      finding.httpStatus === null ? null : String(finding.httpStatus),
      finding.failureCode,
    ]
      .filter((value): value is string => value !== null)
      .map(boundedTerminalText)
      .join(" ");
    items.push({
      priority: finding.severity === "ERROR" ? 0 : 5,
      key: `runtime:${finding.identity}`,
      line: `NEW runtime ${finding.severity === "ERROR" ? "failure" : "review"}: ${boundedTerminalText(finding.summary)}${target.length > 0 ? ` · ${target}` : ""}`,
    });
  }
  for (const diagnostic of report.coverage.observation.diagnostics) {
    items.push({
      priority: 1,
      key: `coverage:${diagnostic.code}:${diagnostic.message}`,
      line: `OBSERVATION ${diagnostic.code}: ${boundedTerminalText(diagnostic.message)}`,
    });
  }
  for (const diagnostic of report.diagnostics) {
    items.push({
      priority: 1,
      key: `privacy-diagnostic:${diagnostic.code}:${diagnostic.message}`,
      line: `PRIVACY ${boundedTerminalText(diagnostic.code)}: ${boundedTerminalText(diagnostic.message)}`,
    });
  }
  if (report.integrationErrors.length > 0) {
    items.push({
      priority: 1,
      key: "integration-errors",
      line: `INTEGRATION_ERROR: ${report.integrationErrors.length} integration error${report.integrationErrors.length === 1 ? "" : "s"} recorded; inspect the private report or command log`,
    });
  }
  for (const finding of report.analysis.dependencies.findings) {
    items.push({
      priority: 2,
      key: `dependency:${finding.identity}`,
      line: `NEW runtime dependency: ${boundedTerminalText(finding.origin)} · ${boundedTerminalText(finding.observedAs)}`,
    });
  }
  for (const finding of report.analysis.security.findings) {
    items.push({
      priority: 4,
      key: `security:${finding.identity}`,
      line: `CHANGED browser security posture: ${boundedTerminalText(finding.host)}${boundedTerminalText(finding.endpoint)} · ${boundedTerminalText(finding.property)} · ${boundedTerminalText(finding.previous)} → ${boundedTerminalText(finding.current)}`,
    });
  }
  return items.sort(
    (left, right) => left.priority - right.priority || compareCanonicalStrings(left.key, right.key),
  );
};

const moduleRow = (label: string, status: string, details: string): string =>
  `${label.padEnd(22)}${status.toUpperCase().padEnd(14)}${details}`;

const countLabel = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const configuredBaselineCount = (report: PrivacySpecJsonReportV5): number =>
  [
    report.baseline.exists,
    report.analysis.dependencies.baseline.exists,
    report.analysis.security.baseline.exists,
    report.analysis.runtimeErrors.baseline.exists,
  ].filter(Boolean).length;

export const renderSecondaryCoverageSummary = (report: PrivacySpecJsonReportV5): string => {
  const { analysis } = report;
  const actionable = actionableTerminalItems(report);
  const selected = actionable.slice(0, MAX_SECONDARY_COVERAGE_TERMINAL_ITEMS);
  const baselines = configuredBaselineCount(report);
  const lines = [
    "PrivacySpec Secondary Coverage",
    "",
    moduleRow(
      "Functional tests",
      playwrightStatusLabel(report.run.playwrightStatus),
      `${report.run.tests.passed}/${report.run.tests.total} passed; ${report.run.tests.observed} observed`,
    ),
    `${"Observation coverage".padEnd(22)}${coverageLabel(report.coverage.observation.status).padEnd(14)}contexts ${report.coverage.observation.contexts.instrumented}/${report.coverage.observation.contexts.seen}; pages ${report.coverage.observation.pages.instrumented}/${report.coverage.observation.pages.seen}`,
    moduleRow("Secondary coverage", analysis.status, countLabel(analysis.changes.total, "change")),
    "",
    moduleRow(
      "Privacy",
      analysis.privacy.status,
      `${countLabel(analysis.changes.privacy, "change")}; ${countLabel(analysis.privacy.summary.dataFlows, "flow")}`,
    ),
    moduleRow(
      "Dependencies",
      analysis.dependencies.status,
      `${countLabel(analysis.changes.dependencies, "change")}; ${countLabel(analysis.dependencies.inventory.length, "origin")}`,
    ),
    moduleRow(
      "Security",
      analysis.security.status,
      `${countLabel(analysis.changes.security, "change")}; ${countLabel(analysis.security.inventory.length, "target")}`,
    ),
    moduleRow(
      "Runtime",
      analysis.runtimeErrors.status,
      `${countLabel(analysis.changes.runtimeErrors, "change")}; ${countLabel(analysis.runtimeErrors.inventory.length, "failure")}`,
    ),
  ];
  if (selected.length > 0) {
    lines.push("", "Worth reviewing", "");
    for (const item of selected) lines.push(`  ${item.line}`);
    const omitted = actionable.length - selected.length;
    if (omitted > 0) {
      lines.push(
        `  ${omitted} additional actionable group${omitted === 1 ? "" : "s"} omitted; see the private JSON report.`,
      );
    } else {
      lines.push("", "See the private JSON report for sanitized evidence.");
    }
  } else if (analysis.status === "inconclusive") {
    lines.push(
      "",
      "No clean conclusion is available; inspect observation coverage and diagnostics.",
    );
  } else {
    lines.push("", "No new secondary findings require action.");
  }
  if (baselines < 4) {
    lines.push(
      "",
      baselines === 0
        ? analysis.status === "inconclusive"
          ? "Baseline tracking is optional and cannot repair incomplete observation."
          : "Baseline tracking is optional; current-run observations are useful without it."
        : `Baseline tracking: ${baselines}/4 modules configured; current-run observations do not require the remaining baselines.`,
    );
  }
  return `${lines.join("\n")}\n`;
};

const markdownText = (value: string): string => {
  const safe = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined &&
      (codePoint < 32 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069))
      ? "�"
      : character;
  }).join("");
  return safe
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/([\\`*_[\]{}()#+.!|])/gu, "\\$1");
};

const resolvedCount = (report: PrivacySpecJsonReportV5, count: number): string =>
  report.run.complete ? String(count) : "—";

const privacyFindingKey = (finding: Finding): string =>
  JSON.stringify([
    finding.ruleId,
    finding.flow.dataCategory,
    finding.flow.sinkKind,
    finding.flow.recipient?.origin ?? null,
    finding.flow.endpoint ?? null,
    finding.flow.location ?? null,
    finding.flow.transform,
    finding.flow.requestSurface ?? "browser",
  ]);

const actionablePrivacyFindings = (findings: readonly ReportFinding[]): Finding[] => {
  const byKey = new Map<string, Finding>();
  for (const entry of findings) {
    if (
      entry.finding.classification !== "technical_failure" &&
      !(entry.finding.classification === "review_required" && entry.baselineState === "new")
    ) {
      continue;
    }
    const key = privacyFindingKey(entry.finding);
    if (!byKey.has(key)) byKey.set(key, entry.finding);
  }
  return Array.from(byKey.entries())
    .sort(([left], [right]) => compareCanonicalStrings(left, right))
    .map(([, finding]) => finding);
};

const privacyFindingLine = (finding: Finding): string => {
  const flow = finding.flow;
  const destination = [flow.recipient?.origin, flow.endpoint, flow.location].filter(
    (value): value is string => value !== undefined,
  );
  const classification =
    finding.classification === "technical_failure" ? "TECHNICAL_FAILURE" : "REVIEW_REQUIRED";
  const requestSurface =
    flow.requestSurface === "api-request" ? " — **surface: API request fixture**" : "";
  const suffix =
    destination.length === 0
      ? ""
      : ` — ${destination.map((value) => markdownText(value)).join(" · ")}`;
  return `- **${markdownText(classification)} ${markdownText(finding.ruleId)}**${requestSurface} — ${markdownText(flow.dataCategory)} → ${markdownText(flow.sinkKind)}${suffix} [${markdownText(flow.transform)}]`;
};

const dependencyFindingLine = (
  finding: PrivacySpecJsonReportV5["analysis"]["dependencies"]["findings"][number],
): string =>
  `- **REVIEW_REQUIRED ${markdownText(finding.ruleId)}** — ${markdownText(finding.origin)} observed as ${markdownText(finding.observedAs)}`;

const securityFindingLine = (
  finding: PrivacySpecJsonReportV5["analysis"]["security"]["findings"][number],
): string =>
  `- **REVIEW_REQUIRED ${markdownText(finding.ruleId)}** — ${markdownText(finding.host)}${markdownText(finding.endpoint)} ${markdownText(finding.property)}: ${markdownText(finding.previous)} → ${markdownText(finding.current)}`;

const runtimeFindingLine = (
  finding: PrivacySpecJsonReportV5["analysis"]["runtimeErrors"]["findings"][number],
): string => {
  const target = [
    finding.method,
    finding.host,
    finding.endpoint,
    finding.httpStatus === null ? null : String(finding.httpStatus),
    finding.failureCode,
  ].filter((value): value is string => value !== null);
  const suffix =
    target.length === 0 ? "" : ` — ${target.map((value) => markdownText(value)).join(" ")}`;
  return `- **${markdownText(finding.classification)} ${markdownText(finding.ruleId)}** — ${markdownText(finding.summary)}${suffix}`;
};

interface MarkdownSection {
  heading: string;
  items: string[];
  maxItems: number;
}

const canonicalUnique = (values: readonly string[]): string[] =>
  Array.from(new Set(values)).sort(compareCanonicalStrings);

const renderBoundedSections = (
  baseLines: string[],
  sections: readonly MarkdownSection[],
): string => {
  const lines = [...baseLines];
  let bytes = Buffer.byteLength(`${lines.join("\n")}\n`, "utf8");
  const truncationLine = "- Summary truncated at 64 KiB; additional complete items were omitted.";
  const truncationBytes = Buffer.byteLength(`${truncationLine}\n`, "utf8");
  let capTruncated = false;

  for (const section of sections) {
    if (section.items.length === 0) continue;
    const selected = section.items.slice(0, section.maxItems);
    const headingLines = ["", `### ${section.heading}`, ""];
    const headingBytes = Buffer.byteLength(`${headingLines.join("\n")}\n`, "utf8");
    const firstLine = selected[0] ?? "";
    const firstLineBytes = Buffer.byteLength(`${firstLine}\n`, "utf8");
    if (
      bytes + headingBytes + firstLineBytes + truncationBytes >
      MAX_SECONDARY_COVERAGE_MARKDOWN_BYTES
    ) {
      capTruncated = true;
      break;
    }
    lines.push(...headingLines);
    bytes += headingBytes;

    let rendered = 0;
    for (const item of selected) {
      const lineBytes = Buffer.byteLength(`${item}\n`, "utf8");
      if (bytes + lineBytes + truncationBytes > MAX_SECONDARY_COVERAGE_MARKDOWN_BYTES) {
        capTruncated = true;
        break;
      }
      lines.push(item);
      bytes += lineBytes;
      rendered += 1;
    }

    const omitted = section.items.length - rendered;
    if (omitted > 0) {
      const omittedLine = `- ${omitted} additional item${omitted === 1 ? "" : "s"} omitted.`;
      const omittedBytes = Buffer.byteLength(`${omittedLine}\n`, "utf8");
      if (bytes + omittedBytes + truncationBytes > MAX_SECONDARY_COVERAGE_MARKDOWN_BYTES) {
        capTruncated = true;
        break;
      }
      lines.push(omittedLine);
      bytes += omittedBytes;
    }
  }
  if (capTruncated) lines.push(truncationLine);
  return `${lines.join("\n")}\n`;
};

export const renderSecondaryCoverageMarkdown = (report: PrivacySpecJsonReportV5): string => {
  const { analysis } = report;
  const baseLines = [
    "# PrivacySpec Secondary Coverage",
    "",
    "| Layer | Status | Details |",
    "| --- | --- | --- |",
    `| Functional tests | ${playwrightStatusLabel(report.run.playwrightStatus)} | ${report.run.tests.passed}/${report.run.tests.total} passed; ${report.run.tests.observed} observed |`,
    `| Observation coverage | ${coverageLabel(report.coverage.observation.status)} | contexts ${report.coverage.observation.contexts.instrumented}/${report.coverage.observation.contexts.seen}; pages ${report.coverage.observation.pages.instrumented}/${report.coverage.observation.pages.seen} |`,
    `| Browser engines | ${report.coverage.browserEngines.tests.unsupported > 0 ? "UNSUPPORTED" : report.coverage.browserEngines.tests.experimental > 0 ? "EXPERIMENTAL" : "SUPPORTED"} | supported ${report.coverage.browserEngines.tests.supported}; experimental ${report.coverage.browserEngines.tests.experimental}; unsupported ${report.coverage.browserEngines.tests.unsupported} |`,
    `| API request fixture | ${report.coverage.apiRequests.tests.unsupported > 0 ? "UNSUPPORTED" : report.coverage.apiRequests.tests.partial > 0 ? "PARTIAL" : "COMPLETE"} | ${report.coverage.apiRequests.calls.seen} calls |`,
    `| Secondary coverage | ${statusLabel(analysis.status)} | ${analysis.changes.total} changes |`,
    "",
    "| Module | Status | Coverage | Changes | Observed | Known | New/changed | Resolved |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    `| Privacy | ${statusLabel(analysis.privacy.status)} | ${coverageLabel(analysis.privacy.coverage)} | ${analysis.changes.privacy} | ${analysis.privacy.summary.dataFlows} | ${analysis.privacy.summary.baseline.known} | ${analysis.privacy.summary.baseline.new} | ${resolvedCount(report, analysis.privacy.summary.baseline.resolved)} |`,
    `| Dependencies | ${statusLabel(analysis.dependencies.status)} | ${coverageLabel(analysis.dependencies.coverage)} | ${analysis.changes.dependencies} | ${analysis.dependencies.inventory.length} | ${analysis.dependencies.baseline.known} | ${analysis.dependencies.baseline.new} | ${resolvedCount(report, analysis.dependencies.baseline.resolved)} |`,
    `| Security | ${statusLabel(analysis.security.status)} | ${coverageLabel(analysis.security.coverage)} | ${analysis.changes.security} | ${analysis.security.inventory.length} | ${analysis.security.baseline.known} | ${analysis.security.baseline.newTargets + analysis.security.baseline.changed} | ${resolvedCount(report, analysis.security.baseline.resolved)} |`,
    `| Runtime | ${statusLabel(analysis.runtimeErrors.status)} | ${coverageLabel(analysis.runtimeErrors.coverage)} | ${analysis.changes.runtimeErrors} | ${analysis.runtimeErrors.inventory.length} | ${analysis.runtimeErrors.baseline.known} | ${analysis.runtimeErrors.baseline.new} | ${resolvedCount(report, analysis.runtimeErrors.baseline.resolved)} |`,
  ];

  const coverageDiagnostics = canonicalUnique(
    report.coverage.observation.diagnostics.map(
      (diagnostic) =>
        `- **${markdownText(diagnostic.code)}** — ${markdownText(diagnostic.message)}`,
    ),
  );
  const integrationDiagnostics = [...report.integrationErrors]
    .sort(compareCanonicalStrings)
    .map(
      (_message, index) =>
        `- **INTEGRATION_ERROR** — Integration error ${index + 1} was recorded; inspect the private JSON report or action log.`,
    );

  return renderBoundedSections(baseLines, [
    {
      heading: "Privacy changes",
      items: actionablePrivacyFindings(report.findings).map(privacyFindingLine),
      maxItems: MAX_SECONDARY_COVERAGE_ITEMS_PER_MODULE,
    },
    {
      heading: "Dependency changes",
      items: [...analysis.dependencies.findings]
        .sort((left, right) => compareCanonicalStrings(left.identity, right.identity))
        .map(dependencyFindingLine),
      maxItems: MAX_SECONDARY_COVERAGE_ITEMS_PER_MODULE,
    },
    {
      heading: "Security changes",
      items: [...analysis.security.findings]
        .sort((left, right) => compareCanonicalStrings(left.identity, right.identity))
        .map(securityFindingLine),
      maxItems: MAX_SECONDARY_COVERAGE_ITEMS_PER_MODULE,
    },
    {
      heading: "Runtime changes",
      items: [...analysis.runtimeErrors.findings]
        .sort((left, right) => compareCanonicalStrings(left.identity, right.identity))
        .map(runtimeFindingLine),
      maxItems: MAX_SECONDARY_COVERAGE_ITEMS_PER_MODULE,
    },
    {
      heading: "Coverage and integration diagnostics",
      items: [...coverageDiagnostics, ...integrationDiagnostics],
      maxItems: MAX_SECONDARY_COVERAGE_DIAGNOSTICS,
    },
  ]);
};
