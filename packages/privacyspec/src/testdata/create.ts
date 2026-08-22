import type { PrivacySpecJsonReport } from "../report/model.js";
import {
  type PrivacySpecTestDataAttachment,
  type PrivacySpecTestDataReport,
  type PrivacySpecTestDataSection,
  TEST_DATA_SCHEMA_VERSION,
  type TestDataObservation,
  type TestDataSummary,
} from "./model.js";

export const BFDI_TEST_DATA_GUIDANCE_URL =
  "https://www.bfdi.bund.de/DE/Fachthemen/Inhalte/Technik/Kurzposition_Testdaten.html";
export const IANA_EXAMPLE_DOMAINS_URL = "https://www.iana.org/help/example-domains";

const BASE_LIMITATIONS = [
  "Classification covers only email values already observed in browser input controls; unsupported categories and sources are not expanded in Phase 16.",
  "SYNTHETIC means the email domain matched an IANA-reserved example/special-use domain or an explicitly configured synthetic domain.",
  "REVIEW_REQUIRED means only that the email domain was not recognized as synthetic; it does not establish that the value belongs to a real person or that the domain is externally routable.",
  "PrivacySpec performs no DNS or network lookup for test-data hygiene.",
  `BfDI guidance recommends considering non-personal or anonymous test data, then pseudonymous data, before unchanged personal data: ${BFDI_TEST_DATA_GUIDANCE_URL}`,
  `Reserved example-domain semantics are based on IANA documentation: ${IANA_EXAMPLE_DOMAINS_URL}`,
] as const;

const summarize = (observations: readonly TestDataObservation[]): TestDataSummary => ({
  total: observations.length,
  synthetic: observations.filter((item) => item.verdict === "SYNTHETIC").length,
  reviewRequired: observations.filter((item) => item.verdict === "REVIEW_REQUIRED").length,
  unassessed: observations.filter((item) => item.verdict === "UNASSESSED").length,
});

const uniqueSortedObservations = (
  observations: readonly TestDataObservation[],
): TestDataObservation[] => {
  const unique = new Map<string, TestDataObservation>();
  for (const observation of observations) unique.set(JSON.stringify(observation), observation);
  return Array.from(unique.values()).sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
};

export const createTestDataAttachment = (
  observations: readonly TestDataObservation[],
): PrivacySpecTestDataAttachment => ({
  testDataSchemaVersion: TEST_DATA_SCHEMA_VERSION,
  observations: uniqueSortedObservations(observations),
});

export const createTestDataSection = (
  observations: readonly TestDataObservation[],
  additionalLimitations: readonly string[] = [],
): PrivacySpecTestDataSection => {
  const sorted = uniqueSortedObservations(observations);
  const limitations = Array.from(new Set([...BASE_LIMITATIONS, ...additionalLimitations])).sort(
    (left, right) => left.localeCompare(right),
  );
  return {
    testDataSchemaVersion: TEST_DATA_SCHEMA_VERSION,
    summary: summarize(sorted),
    observations: sorted,
    limitations,
  };
};

export const createTestDataReport = (report: PrivacySpecJsonReport): PrivacySpecTestDataReport => {
  const available = report.schemaVersion !== 1 && report.testData !== undefined;
  const additionalLimitations: string[] = [];
  if (!available) {
    additionalLimitations.push(
      "The source report does not contain Phase 16 test-data observations; absence is inconclusive.",
    );
  }
  if (!report.run.complete) {
    additionalLimitations.push(
      "The source run is incomplete; missing test-data observations must not be treated as verified absence.",
    );
  }
  const section = createTestDataSection(available ? (report.testData?.observations ?? []) : [], [
    ...(available ? (report.testData?.limitations ?? []) : []),
    ...additionalLimitations,
  ]);
  return {
    ...section,
    tool: { ...report.tool },
    sourceReport: {
      schemaVersion: report.schemaVersion,
      generatedAt: report.generatedAt,
      complete: report.run.complete,
      status: report.run.privacyspecStatus,
      testDataAvailable: available,
      projects: [...report.run.projects],
      tests: { ...report.run.tests },
    },
  };
};
