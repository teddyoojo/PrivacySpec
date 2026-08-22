import type { PrivacySpecJsonReportV4, SecondaryAnalysisStatus } from "./model.js";

const statusLabel = (status: SecondaryAnalysisStatus): string => status.toUpperCase();

const playwrightStatusLabel = (
  status: PrivacySpecJsonReportV4["run"]["playwrightStatus"],
): string => {
  if (status === "passed") return "PASS";
  if (status === "failed") return "FAIL";
  if (status === "timedout") return "TIMED_OUT";
  return "INTERRUPTED";
};

const coverageLabel = (coverage: string): string => coverage.toUpperCase();

export const renderSecondaryCoverageSummary = (report: PrivacySpecJsonReportV4): string => {
  const { analysis } = report;
  const lines = [
    "PrivacySpec Secondary Coverage",
    `Functional tests: ${playwrightStatusLabel(report.run.playwrightStatus)} (${report.run.tests.passed}/${report.run.tests.total} passed; ${report.run.tests.observed} observed)`,
    `Observation coverage: ${coverageLabel(report.coverage.observation.status)} (contexts=${report.coverage.observation.contexts.instrumented}/${report.coverage.observation.contexts.seen}, pages=${report.coverage.observation.pages.instrumented}/${report.coverage.observation.pages.seen}, navigations=${report.coverage.observation.events.navigations}, network=${report.coverage.observation.events.network}, console=${report.coverage.observation.events.console})`,
    `Secondary coverage: ${statusLabel(analysis.status)}`,
    `  privacy       ${statusLabel(analysis.privacy.status)} (coverage=${coverageLabel(analysis.privacy.coverage)}, changes=${analysis.changes.privacy}, flows=${analysis.privacy.summary.dataFlows})`,
    `  dependencies  ${statusLabel(analysis.dependencies.status)} (coverage=${coverageLabel(analysis.dependencies.coverage)}, changes=${analysis.changes.dependencies}, origins=${analysis.dependencies.inventory.length})`,
    `  security      ${statusLabel(analysis.security.status)} (coverage=${coverageLabel(analysis.security.coverage)}, changes=${analysis.changes.security}, targets=${analysis.security.inventory.length})`,
    `  runtime       ${statusLabel(analysis.runtimeErrors.status)} (coverage=${coverageLabel(analysis.runtimeErrors.coverage)}, changes=${analysis.changes.runtimeErrors}, failures=${analysis.runtimeErrors.inventory.length})`,
    `Changes: ${analysis.changes.total} (privacy=${analysis.changes.privacy}, dependencies=${analysis.changes.dependencies}, security=${analysis.changes.security}, runtime=${analysis.changes.runtimeErrors})`,
  ];
  return `${lines.join("\n")}\n`;
};
