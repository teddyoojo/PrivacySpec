import { compareCanonicalStrings } from "../canonical-order.js";
import type { Finding } from "../rules/model.js";
import type { PrivacySpecJsonReportV5, ReportFinding, SecondaryAnalysisStatus } from "./model.js";

export type SecondaryCoverageSummaryFormat = "terminal" | "markdown";

export const MAX_SECONDARY_COVERAGE_MARKDOWN_BYTES = 64 * 1024;
export const MAX_SECONDARY_COVERAGE_ITEMS_PER_MODULE = 5;
export const MAX_SECONDARY_COVERAGE_DIAGNOSTICS = 5;

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

export const renderSecondaryCoverageSummary = (report: PrivacySpecJsonReportV5): string => {
  const { analysis } = report;
  const lines = [
    "PrivacySpec Secondary Coverage",
    `Functional tests: ${playwrightStatusLabel(report.run.playwrightStatus)} (${report.run.tests.passed}/${report.run.tests.total} passed; ${report.run.tests.observed} observed)`,
    `Observation coverage: ${coverageLabel(report.coverage.observation.status)} (contexts=${report.coverage.observation.contexts.instrumented}/${report.coverage.observation.contexts.seen}, pages=${report.coverage.observation.pages.instrumented}/${report.coverage.observation.pages.seen}, navigations=${report.coverage.observation.events.navigations}, network=${report.coverage.observation.events.network}, console=${report.coverage.observation.events.console})`,
    `Browser engines: supported=${report.coverage.browserEngines.tests.supported}, experimental=${report.coverage.browserEngines.tests.experimental}, unsupported=${report.coverage.browserEngines.tests.unsupported}, unavailable=${report.coverage.browserEngines.tests.unavailable}`,
    `API request fixture: calls=${report.coverage.apiRequests.calls.seen}, partial=${report.coverage.apiRequests.tests.partial}, unsupported=${report.coverage.apiRequests.tests.unsupported}`,
    `Secondary coverage: ${statusLabel(analysis.status)}`,
    `  privacy       ${statusLabel(analysis.privacy.status)} (coverage=${coverageLabel(analysis.privacy.coverage)}, changes=${analysis.changes.privacy}, flows=${analysis.privacy.summary.dataFlows})`,
    `  dependencies  ${statusLabel(analysis.dependencies.status)} (coverage=${coverageLabel(analysis.dependencies.coverage)}, changes=${analysis.changes.dependencies}, origins=${analysis.dependencies.inventory.length})`,
    `  security      ${statusLabel(analysis.security.status)} (coverage=${coverageLabel(analysis.security.coverage)}, changes=${analysis.changes.security}, targets=${analysis.security.inventory.length})`,
    `  runtime       ${statusLabel(analysis.runtimeErrors.status)} (coverage=${coverageLabel(analysis.runtimeErrors.coverage)}, changes=${analysis.changes.runtimeErrors}, failures=${analysis.runtimeErrors.inventory.length})`,
    `Changes: ${analysis.changes.total} (privacy=${analysis.changes.privacy}, dependencies=${analysis.changes.dependencies}, security=${analysis.changes.security}, runtime=${analysis.changes.runtimeErrors})`,
  ];
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
