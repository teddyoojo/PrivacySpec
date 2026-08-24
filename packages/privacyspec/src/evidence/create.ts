import { type DataCategory, isDataCategory } from "../discovery/source-model.js";
import type { PrivacySpecJsonReport } from "../report/model.js";
import { RULE_DEFINITIONS } from "../rules/definitions.js";
import type { RegulatoryMapping, TechnicalControlMapping } from "../rules/legal-map.js";
import type { FindingClassification, RuleId } from "../rules/model.js";
import {
  EVIDENCE_SCHEMA_VERSION,
  type EvidenceBuildIdentifiers,
  type EvidenceCategoryObservation,
  type EvidenceExternalRecipientObservation,
  type EvidenceRegulatoryRelevance,
  type EvidenceReportLevelRegulatoryRelevance,
  type EvidenceRuleObservation,
  type EvidenceTechnicalRelevance,
  type PrivacySpecEvidence,
} from "./model.js";

export interface CreateEvidenceOptions extends EvidenceBuildIdentifiers {
  generatedAt?: string | undefined;
}

const RULE_IDS = new Set<RuleId>(Object.keys(RULE_DEFINITIONS) as RuleId[]);
const EVIDENCE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:+/-]{0,127}$/u;
const MAX_MAPPING_TEXT = 8_192;
const MAX_MAPPING_ITEMS = 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const containsUnsafeCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint < 32 ||
        (codePoint >= 127 && codePoint <= 159) ||
        codePoint === 0x2028 ||
        codePoint === 0x2029 ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2066 && codePoint <= 0x2069))
    ) {
      return true;
    }
  }
  return false;
};

const isSafeText = (value: unknown, maxLength = MAX_MAPPING_TEXT): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maxLength &&
  !/[^\s@]+@[^\s@]+/u.test(value) &&
  !containsUnsafeCharacter(value);

const isCanonicalTimestamp = (value: string): boolean => {
  const date = new Date(value);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === value;
};

export const validateEvidenceIdentifier = (value: string, label: "commit" | "build ID"): string => {
  if (!EVIDENCE_IDENTIFIER.test(value) || value.includes("..") || value.includes("//")) {
    throw new TypeError(`The evidence ${label} is invalid.`);
  }
  return value;
};

const copyTechnicalControl = (value: unknown): TechnicalControlMapping | undefined => {
  if (
    !isRecord(value) ||
    value.framework !== "OWASP ASVS" ||
    value.version !== "5.0.0" ||
    !isSafeText(value.control) ||
    !isSafeText(value.requirementId) ||
    (value.relationship !== "direct" && value.relationship !== "contextual") ||
    !isSafeText(value.rationale) ||
    !isSafeText(value.applicabilityCaveat) ||
    !isSafeText(value.sourceUrl) ||
    !isSafeText(value.lastReviewed, 64)
  ) {
    return undefined;
  }
  return {
    framework: "OWASP ASVS",
    version: "5.0.0",
    control: value.control,
    requirementId: value.requirementId,
    relationship: value.relationship,
    rationale: value.rationale,
    applicabilityCaveat: value.applicabilityCaveat,
    sourceUrl: value.sourceUrl,
    lastReviewed: value.lastReviewed,
  };
};

const copyRegulatoryMapping = (value: unknown): RegulatoryMapping | undefined => {
  if (
    !isRecord(value) ||
    !isSafeText(value.instrument) ||
    !isSafeText(value.provision) ||
    (value.relationship !== "contextual" && value.relationship !== "supporting_evidence") ||
    !isSafeText(value.rationale) ||
    !isSafeText(value.applicabilityCaveat) ||
    value.sourceType !== "primary" ||
    !isSafeText(value.sourceUrl) ||
    !isSafeText(value.lastReviewed, 64)
  ) {
    return undefined;
  }
  return {
    instrument: value.instrument,
    provision: value.provision,
    relationship: value.relationship,
    rationale: value.rationale,
    applicabilityCaveat: value.applicabilityCaveat,
    sourceType: "primary",
    sourceUrl: value.sourceUrl,
    lastReviewed: value.lastReviewed,
  };
};

interface SafeRuleMapping {
  ruleId: RuleId;
  observationRule: string;
  technicalControls: TechnicalControlMapping[];
  regulatoryRelevance: RegulatoryMapping[];
  limitations: string[];
}

const copyStringArray = (value: unknown): string[] | undefined => {
  if (
    !Array.isArray(value) ||
    value.length > MAX_MAPPING_ITEMS ||
    !value.every((item) => isSafeText(item))
  ) {
    return undefined;
  }
  return Array.from(new Set(value)).sort((left, right) => left.localeCompare(right));
};

const copyRuleMapping = (value: unknown): SafeRuleMapping | undefined => {
  if (
    !isRecord(value) ||
    typeof value.ruleId !== "string" ||
    !RULE_IDS.has(value.ruleId as RuleId) ||
    !isSafeText(value.observationRule) ||
    !Array.isArray(value.technicalControls) ||
    value.technicalControls.length > MAX_MAPPING_ITEMS ||
    !Array.isArray(value.regulatoryRelevance) ||
    value.regulatoryRelevance.length > MAX_MAPPING_ITEMS
  ) {
    return undefined;
  }
  const technicalControls = value.technicalControls.map(copyTechnicalControl);
  const regulatoryRelevance = value.regulatoryRelevance.map(copyRegulatoryMapping);
  const limitations = copyStringArray(value.limitations);
  if (
    technicalControls.some((item) => item === undefined) ||
    regulatoryRelevance.some((item) => item === undefined) ||
    limitations === undefined
  ) {
    return undefined;
  }
  return {
    ruleId: value.ruleId as RuleId,
    observationRule: value.observationRule,
    technicalControls: technicalControls as TechnicalControlMapping[],
    regulatoryRelevance: regulatoryRelevance as RegulatoryMapping[],
    limitations,
  };
};

interface SafeReportLevelMapping {
  profileId: string;
  title: string;
  observation: string;
  regulatoryRelevance: RegulatoryMapping[];
  limitations: string[];
}

const copyReportLevelMapping = (value: unknown): SafeReportLevelMapping | undefined => {
  if (
    !isRecord(value) ||
    !isSafeText(value.profileId, 128) ||
    !isSafeText(value.title) ||
    !isSafeText(value.observation) ||
    !Array.isArray(value.regulatoryRelevance) ||
    value.regulatoryRelevance.length > MAX_MAPPING_ITEMS
  ) {
    return undefined;
  }
  const regulatoryRelevance = value.regulatoryRelevance.map(copyRegulatoryMapping);
  const limitations = copyStringArray(value.limitations);
  if (regulatoryRelevance.some((item) => item === undefined) || limitations === undefined) {
    return undefined;
  }
  return {
    profileId: value.profileId,
    title: value.title,
    observation: value.observation,
    regulatoryRelevance: regulatoryRelevance as RegulatoryMapping[],
    limitations,
  };
};

const categoryObservations = (report: PrivacySpecJsonReport): EvidenceCategoryObservation[] => {
  const categories = new Set<DataCategory>();
  for (const category of Object.keys(report.summary.sensitiveSources.byName)) {
    if (isDataCategory(category)) categories.add(category);
  }
  for (const flow of report.flows) categories.add(flow.dataCategory);
  return Array.from(categories)
    .sort((left, right) => left.localeCompare(right))
    .map((category) => ({
      category,
      sourceObservations: report.summary.sensitiveSources.byName[category] ?? 0,
      flowOccurrences: report.flows.filter((flow) => flow.dataCategory === category).length,
    }));
};

const externalRecipientObservations = (
  report: PrivacySpecJsonReport,
): EvidenceExternalRecipientObservation[] => {
  const recipients = new Map<
    string,
    { origin: string; host: string; flowOccurrences: number; categories: Set<DataCategory> }
  >();
  for (const flow of report.flows) {
    if (flow.recipient === undefined || flow.recipient.firstParty) continue;
    const key = JSON.stringify([flow.recipient.origin, flow.recipient.host]);
    const recipient = recipients.get(key) ?? {
      origin: flow.recipient.origin,
      host: flow.recipient.host,
      flowOccurrences: 0,
      categories: new Set<DataCategory>(),
    };
    recipient.flowOccurrences += 1;
    recipient.categories.add(flow.dataCategory);
    recipients.set(key, recipient);
  }
  return Array.from(recipients.values())
    .sort(
      (left, right) =>
        left.origin.localeCompare(right.origin) || left.host.localeCompare(right.host),
    )
    .map((recipient) => ({
      origin: recipient.origin,
      host: recipient.host,
      flowOccurrences: recipient.flowOccurrences,
      categories: Array.from(recipient.categories).sort((left, right) => left.localeCompare(right)),
    }));
};

const ruleObservations = (
  report: PrivacySpecJsonReport,
  mappings: ReadonlyMap<RuleId, SafeRuleMapping>,
): EvidenceRuleObservation[] => {
  const rules = new Map<
    RuleId,
    {
      ruleId: RuleId;
      title: string;
      observation: string;
      occurrences: number;
      technicalFailures: number;
      reviewRequired: number;
    }
  >();
  for (const { finding } of report.findings) {
    const current = rules.get(finding.ruleId) ?? {
      ruleId: finding.ruleId,
      title: RULE_DEFINITIONS[finding.ruleId].title,
      observation: mappings.get(finding.ruleId)?.observationRule ?? finding.observation,
      occurrences: 0,
      technicalFailures: 0,
      reviewRequired: 0,
    };
    current.occurrences += 1;
    if (finding.classification === "technical_failure") current.technicalFailures += 1;
    if (finding.classification === "review_required") current.reviewRequired += 1;
    rules.set(finding.ruleId, current);
  }
  return Array.from(rules.values()).sort((left, right) => left.ruleId.localeCompare(right.ruleId));
};

const findingCount = (
  report: PrivacySpecJsonReport,
  classification: FindingClassification,
): number =>
  report.findings.filter(({ finding }) => finding.classification === classification).length;

const copyResponseCoverage = (
  report: PrivacySpecJsonReport,
): PrivacySpecEvidence["coverage"]["firstPartyJsonResponses"] => {
  if (report.schemaVersion === 1) return { available: false };
  const coverage = report.coverage.firstPartyJsonResponses;
  return {
    available: true,
    details: {
      experimental: true,
      tests: { ...coverage.tests },
      responses: { ...coverage.responses },
      retainedBytes: coverage.retainedBytes,
      discoveredSources: {
        total: coverage.discoveredSources.total,
        byName: { ...coverage.discoveredSources.byName },
      },
      skipped: { ...coverage.skipped },
    },
  };
};

const copyExperimentalCoverage = (report: PrivacySpecJsonReport) =>
  report.schemaVersion === 5
    ? {
        browserEngines: {
          available: true as const,
          details: structuredClone(report.coverage.browserEngines),
        },
        apiRequests: {
          available: true as const,
          details: structuredClone(report.coverage.apiRequests),
        },
      }
    : {
        browserEngines: { available: false as const },
        apiRequests: { available: false as const },
      };

const buildIdentifiers = (options: CreateEvidenceOptions): EvidenceBuildIdentifiers => ({
  ...(options.commit === undefined
    ? {}
    : { commit: validateEvidenceIdentifier(options.commit, "commit") }),
  ...(options.buildId === undefined
    ? {}
    : { buildId: validateEvidenceIdentifier(options.buildId, "build ID") }),
});

export const createPrivacySpecEvidence = (
  report: PrivacySpecJsonReport,
  options: CreateEvidenceOptions = {},
): PrivacySpecEvidence => {
  const evidenceGeneratedAt = options.generatedAt ?? new Date().toISOString();
  if (!isCanonicalTimestamp(evidenceGeneratedAt)) {
    throw new TypeError("The evidence generation timestamp is invalid.");
  }
  const build = buildIdentifiers(options);

  const ruleMappings = new Map<RuleId, SafeRuleMapping>();
  let omittedRuleMappings = 0;
  for (const candidate of report.legalMappings.rules) {
    const mapping = copyRuleMapping(candidate);
    if (mapping === undefined || ruleMappings.has(mapping.ruleId)) omittedRuleMappings += 1;
    else ruleMappings.set(mapping.ruleId, mapping);
  }
  const reportLevelMappings: SafeReportLevelMapping[] = [];
  const reportLevelMappingIds = new Set<string>();
  let omittedReportLevelMappings = 0;
  for (const candidate of report.legalMappings.profiles) {
    const mapping = copyReportLevelMapping(candidate);
    if (mapping === undefined || reportLevelMappingIds.has(mapping.profileId)) {
      omittedReportLevelMappings += 1;
    } else {
      reportLevelMappingIds.add(mapping.profileId);
      reportLevelMappings.push(mapping);
    }
  }

  const rules = ruleObservations(report, ruleMappings);
  const observedRuleIds = new Set(rules.map((rule) => rule.ruleId));
  const technicalRelevance: EvidenceTechnicalRelevance[] = Array.from(ruleMappings.values())
    .filter((mapping) => observedRuleIds.has(mapping.ruleId))
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId))
    .map((mapping) => ({
      ruleId: mapping.ruleId,
      controls: mapping.technicalControls,
      limitations: mapping.limitations,
    }));
  const regulatoryRules: EvidenceRegulatoryRelevance[] = Array.from(ruleMappings.values())
    .filter((mapping) => observedRuleIds.has(mapping.ruleId))
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId))
    .map((mapping) => ({
      ruleId: mapping.ruleId,
      mappings: mapping.regulatoryRelevance,
      limitations: mapping.limitations,
    }));
  const regulatoryReportLevel: EvidenceReportLevelRegulatoryRelevance[] = reportLevelMappings
    .sort((left, right) => left.profileId.localeCompare(right.profileId))
    .map((mapping) => ({
      profileId: mapping.profileId,
      title: mapping.title,
      observation: mapping.observation,
      mappings: mapping.regulatoryRelevance,
      limitations: mapping.limitations,
    }));

  const coverageLimitations = [
    "This evidence covers browser-side flows exercised by the observed Playwright scope only.",
    "Backend-only transfers, unexercised journeys, unsupported categories, and arbitrary JavaScript transformations are not observed.",
    "An absent category, recipient, or finding is not evidence of absence outside the recorded test scope.",
    "External means outside the configured first-party boundary; it does not determine recipient ownership, authorization, or trust.",
    "Test-data hygiene covers supported browser-input email values only.",
    "Composed request-fixture observation never classifies API arguments or responses as new sensitive sources.",
  ];
  if (!report.run.complete) {
    coverageLimitations.unshift(
      "INCOMPLETE SOURCE RUN: Missing observations and resolved baseline candidates are inconclusive.",
    );
  }
  if (report.schemaVersion === 1) {
    coverageLimitations.push(
      "The source report predates schema-v2 response coverage and test-data hygiene sections.",
    );
  } else if (report.testData === undefined) {
    coverageLimitations.push(
      "The source report does not contain Phase 16 test-data hygiene observations.",
    );
  }
  if (omittedRuleMappings + omittedReportLevelMappings > 0) {
    coverageLimitations.push(
      `${omittedRuleMappings + omittedReportLevelMappings} malformed or duplicate source mapping record(s) were omitted from this evidence export.`,
    );
  }
  if (Object.keys(build).length === 0) {
    coverageLimitations.push(
      "No build identifiers were supplied; this export does not infer them from Git or the environment.",
    );
  }

  const testData = report.schemaVersion === 1 ? undefined : report.testData;
  const projects = Array.from(new Set(report.run.projects)).sort((left, right) =>
    left.localeCompare(right),
  );
  return {
    evidenceSchemaVersion: EVIDENCE_SCHEMA_VERSION,
    evidenceKind: "AUDIT_SUPPORTING_TECHNICAL_EVIDENCE",
    tool: { ...report.tool },
    execution: {
      evidenceGeneratedAt,
      sourceRunStartedAt: report.run.startedAt,
      sourceReportGeneratedAt: report.generatedAt,
      sourceReportSchemaVersion: report.schemaVersion,
      sourceRunState: report.run.complete ? "COMPLETE" : "INCOMPLETE",
      sourceStatus: report.run.privacyspecStatus,
    },
    build,
    scope: {
      complete: report.run.complete,
      projectCount: projects.length,
      projects,
      tests: { ...report.run.tests },
    },
    observations: {
      categories: categoryObservations(report),
      externalRecipients: externalRecipientObservations(report),
      rules,
      dataFlowOccurrences: report.flows.length,
      requestSurfaces: {
        browser: report.flows.filter((flow) => flow.requestSurface === "browser").length,
        apiRequest: report.flows.filter((flow) => flow.requestSurface === "api-request").length,
      },
      findingOccurrences: {
        technicalFailures: findingCount(report, "technical_failure"),
        reviewRequired: findingCount(report, "review_required"),
      },
      baselineReview: {
        exists: report.baseline.exists,
        known: report.baseline.known.length,
        new: report.baseline.new.length,
        resolved: report.run.complete ? report.baseline.resolved.length : null,
        resolvedStatus: report.run.complete ? "CONCLUSIVE" : "INCONCLUSIVE",
      },
      testDataHygiene: {
        available: testData !== undefined,
        total: testData?.summary.total ?? null,
        synthetic: testData?.summary.synthetic ?? null,
        reviewRequired: testData?.summary.reviewRequired ?? null,
        unassessed: testData?.summary.unassessed ?? null,
      },
    },
    coverage: {
      diagnosticCount: report.diagnostics.length,
      integrationErrorCount: report.integrationErrors.length,
      firstPartyJsonResponses: copyResponseCoverage(report),
      ...copyExperimentalCoverage(report),
    },
    technicalRelevance,
    regulatoryRelevance: {
      rules: regulatoryRules,
      reportLevel: regulatoryReportLevel,
    },
    limitations: {
      coverage: coverageLimitations,
      legal: [
        "This export is audit-supporting technical evidence. It is not an audit opinion, assurance conclusion, or legal advice.",
        "Technical-control relationships describe relevance to the observed fact; they do not determine implementation effectiveness across the system.",
        "Regulatory mappings describe contextual relevance only; applicability depends on jurisdiction, roles, purposes, risk, and organisational context.",
        "PrivacySpec does not determine lawful basis, necessity, processor status, transfer safeguards, or legal status.",
      ],
    },
  };
};
