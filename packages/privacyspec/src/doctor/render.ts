import {
  type DoctorFormat,
  MAX_DOCTOR_TERMINAL_DIAGNOSTICS,
  type PrivacySpecDoctorReport,
} from "./model.js";

const statusLabel = (status: string): string => status.replaceAll("-", "_").toUpperCase();

const row = (label: string, status: string, details: string): string =>
  `${label.padEnd(24)}${statusLabel(status).padEnd(18)}${details}`;

const countLabel = (count: number, noun: string): string =>
  `${count} ${noun}${count === 1 ? "" : "s"}`;

const renderTerminal = (report: PrivacySpecDoctorReport): string => {
  const browserTests = report.browserCoverage.tests;
  const requestTests = report.apiRequestFixture.tests;
  const baselineModules = report.baselines.modules;
  const selectedDiagnostics = report.diagnostics.coverageCodes.slice(
    0,
    MAX_DOCTOR_TERMINAL_DIAGNOSTICS,
  );
  const omittedDiagnostics = report.diagnostics.coverageCodes.length - selectedDiagnostics.length;
  const diagnosticDetails =
    selectedDiagnostics.length === 0
      ? "none"
      : `${selectedDiagnostics.join(", ")}${omittedDiagnostics > 0 ? ` (+${omittedDiagnostics} more)` : ""}`;
  const lines = [
    "PrivacySpec Integration Doctor",
    "",
    row(
      "Setup confidence",
      report.setupConfidence,
      report.setupConfidence === "ready"
        ? "complete supported observation evidence"
        : report.setupConfidence === "limited"
          ? "readable report with limited observation evidence"
          : "instrumented fixture/page evidence is absent",
    ),
    row(
      "Reporter artifact",
      "readable",
      `strict schema v${report.reporterArtifact.reportSchemaVersion}`,
    ),
    row(
      "Fixture observations",
      report.fixtureObservations.status,
      `${report.fixtureObservations.observed}/${report.fixtureObservations.attempts} attempts observed`,
    ),
    row(
      "Run scope",
      report.runScope.status,
      `Playwright ${statusLabel(report.runScope.playwrightStatus)}; ${countLabel(report.runScope.tests, "test")}`,
    ),
    row(
      "Observation coverage",
      report.observation.status,
      `contexts ${report.observation.contexts.instrumented}/${report.observation.contexts.seen}; pages ${report.observation.pages.instrumented}/${report.observation.pages.seen}`,
    ),
    row(
      "Browser coverage",
      report.browserCoverage.status,
      `supported ${browserTests.supported}; experimental ${browserTests.experimental}; unsupported ${browserTests.unsupported}; unavailable ${browserTests.unavailable}`,
    ),
    row(
      "API request fixture",
      report.apiRequestFixture.status,
      `calls ${report.apiRequestFixture.calls.observed}/${report.apiRequestFixture.calls.seen} observed; enabled ${requestTests.enabled}; partial ${requestTests.partial}; unsupported ${requestTests.unsupported}`,
    ),
    row(
      "Baselines",
      "optional",
      `privacy ${baselineModules.privacy}; dependencies ${baselineModules.dependencies}; security ${baselineModules.security}; runtime ${baselineModules.runtime}`,
    ),
    row(
      "Integration errors",
      report.integrationErrors.count === 0 ? "none" : "recorded",
      `${report.integrationErrors.count}`,
    ),
    row(
      "Coverage diagnostics",
      selectedDiagnostics.length === 0 ? "none" : "review",
      diagnosticDetails,
    ),
    row(
      "Other diagnostics",
      report.diagnostics.reportCount + report.diagnostics.analyzerCount === 0 ? "none" : "recorded",
      `report ${report.diagnostics.reportCount}; analyzers ${report.diagnostics.analyzerCount}`,
    ),
    "",
    "Baselines are optional for first-run value. The Playwright reporter remains authoritative for CI exit policy.",
  ];
  return `${lines.join("\n")}\n`;
};

export const renderPrivacySpecDoctorReport = (
  report: PrivacySpecDoctorReport,
  format: DoctorFormat,
): string => (format === "json" ? `${JSON.stringify(report, null, 2)}\n` : renderTerminal(report));
