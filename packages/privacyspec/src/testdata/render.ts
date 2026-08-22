import type { PrivacySpecTestDataReport, TestDataFormat, TestDataObservation } from "./model.js";

const summary = (report: PrivacySpecTestDataReport): string =>
  `${report.summary.total} observations: synthetic=${report.summary.synthetic}, review_required=${report.summary.reviewRequired}, unassessed=${report.summary.unassessed}`;

const controlLabel = (observation: TestDataObservation): string => {
  const control = observation.attribution.control;
  return control === undefined
    ? "no browser-control attribution"
    : `${control.elementKind}/${control.observedBy}`;
};

const observationLabel = (observation: TestDataObservation): string =>
  `${observation.verdict} ${observation.signal} :: ${observation.category} :: ${observation.sourceKind} :: ${observation.attribution.test.title} (${observation.attribution.test.file}; ${observation.attribution.test.project || "unnamed project"}) :: ${controlLabel(observation)}`;

export const renderTestDataTerminal = (report: PrivacySpecTestDataReport): string => {
  const lines = [
    "PrivacySpec Test-Data Hygiene",
    "",
    `Source run: ${report.sourceReport.complete ? "COMPLETE" : "INCOMPLETE"} (${report.sourceReport.status.toUpperCase()})`,
    `Generated: ${report.sourceReport.generatedAt}`,
    `Hygiene data: ${report.sourceReport.testDataAvailable ? "AVAILABLE" : "UNAVAILABLE"}`,
    `Observed scope: ${report.sourceReport.tests.observed}/${report.sourceReport.tests.total} test attempts`,
    `Hygiene: ${summary(report)}`,
  ];
  for (const observation of report.observations) lines.push(`- ${observationLabel(observation)}`);
  if (report.observations.length === 0) {
    lines.push("", "No Phase 16 browser-input email hygiene observations are available.");
  }
  lines.push("", "Limitations:");
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  return `${lines.join("\n")}\n`;
};

const markdownCell = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", " ");

export const renderTestDataMarkdown = (report: PrivacySpecTestDataReport): string => {
  const lines = [
    "# PrivacySpec Test-Data Hygiene",
    "",
    `- Source run: **${report.sourceReport.complete ? "COMPLETE" : "INCOMPLETE"}** (${report.sourceReport.status.toUpperCase()})`,
    `- Generated: ${report.sourceReport.generatedAt}`,
    `- Hygiene data: **${report.sourceReport.testDataAvailable ? "AVAILABLE" : "UNAVAILABLE"}**`,
    `- Observed scope: ${report.sourceReport.tests.observed}/${report.sourceReport.tests.total} test attempts`,
    `- Hygiene: ${summary(report)}`,
    "",
    "| Verdict | Signal | Category | Source | Test | Control |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const observation of report.observations) {
    lines.push(
      `| ${observation.verdict} | ${observation.signal} | ${observation.category} | ${observation.sourceKind} | ${markdownCell(`${observation.attribution.test.title} (${observation.attribution.test.file}; ${observation.attribution.test.project || "unnamed project"})`)} | ${controlLabel(observation)} |`,
    );
  }
  if (report.observations.length === 0) lines.push("| — | — | — | — | No observations | — |");
  lines.push("", "## Limitations", "");
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  return `${lines.join("\n")}\n`;
};

export const renderPrivacySpecTestData = (
  report: PrivacySpecTestDataReport,
  format: TestDataFormat,
): string => {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "markdown") return renderTestDataMarkdown(report);
  return renderTestDataTerminal(report);
};
