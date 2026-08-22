import type { EvidenceFormat, PrivacySpecEvidence } from "./model.js";

const markdownText = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");

const countOrUnavailable = (value: number | null): string =>
  value === null ? "unavailable" : String(value);

const projectLabel = (evidence: PrivacySpecEvidence): string =>
  evidence.scope.projects.length === 0
    ? "none recorded"
    : evidence.scope.projects.map(markdownText).join(", ");

const mappingLimitations = (
  lines: string[],
  mappings: Array<{ ruleId: string; limitations: string[] }>,
): void => {
  const limitations = new Map<string, Set<string>>();
  for (const mapping of mappings) {
    const current = limitations.get(mapping.ruleId) ?? new Set<string>();
    for (const limitation of mapping.limitations) current.add(limitation);
    limitations.set(mapping.ruleId, current);
  }
  if (limitations.size === 0) return;
  lines.push("", "Mapping limitations", "");
  for (const [ruleId, values] of Array.from(limitations).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    for (const limitation of Array.from(values).sort((left, right) => left.localeCompare(right))) {
      lines.push(`- ${ruleId}: ${markdownText(limitation)}`);
    }
  }
};

export const renderEvidenceMarkdown = (evidence: PrivacySpecEvidence): string => {
  const lines = [
    "# PrivacySpec Audit-Supporting Technical Evidence",
    "",
    "> **AUDIT-SUPPORTING TECHNICAL EVIDENCE**",
    ">",
    "> This export records technical observations from an exercised Playwright scope and their source-traceable relevance mappings.",
  ];
  if (!evidence.scope.complete) {
    lines.push(
      ">",
      "> **INCOMPLETE SOURCE RUN — missing observations and resolved baseline candidates are inconclusive.**",
    );
  }
  lines.push(
    "",
    "## Evidence metadata",
    "",
    `- Evidence schema: ${evidence.evidenceSchemaVersion}`,
    `- Evidence generated: ${evidence.execution.evidenceGeneratedAt}`,
    `- Source run started: ${evidence.execution.sourceRunStartedAt}`,
    `- Source report generated: ${evidence.execution.sourceReportGeneratedAt}`,
    `- Source report schema: ${evidence.execution.sourceReportSchemaVersion}`,
    `- Source run: **${evidence.execution.sourceRunState}** (${evidence.execution.sourceStatus.toUpperCase()})`,
    `- Tool: ${markdownText(evidence.tool.name)} ${markdownText(evidence.tool.version)}`,
    `- Commit: ${evidence.build.commit === undefined ? "not supplied" : markdownText(evidence.build.commit)}`,
    `- Build ID: ${evidence.build.buildId === undefined ? "not supplied" : markdownText(evidence.build.buildId)}`,
    "",
    "## 1. Observed technical facts",
    "",
    "This section reports observations and counts only. Relevance mappings appear separately below.",
    "",
    `- Projects: ${evidence.scope.projectCount} (${projectLabel(evidence)})`,
    `- Test attempts: ${evidence.scope.tests.observed}/${evidence.scope.tests.total} observed; ${evidence.scope.tests.passed} passed; ${evidence.scope.tests.failed} failed; ${evidence.scope.tests.timedOut} timed out; ${evidence.scope.tests.skipped} skipped; ${evidence.scope.tests.interrupted} interrupted`,
    `- Data-flow occurrences: ${evidence.observations.dataFlowOccurrences}`,
    `- Finding occurrences: ${evidence.observations.findingOccurrences.technicalFailures} technical failures; ${evidence.observations.findingOccurrences.reviewRequired} review required`,
    `- Baseline review identities: ${evidence.observations.baselineReview.known} known; ${evidence.observations.baselineReview.new} new; ${evidence.observations.baselineReview.resolved === null ? "resolved inconclusive" : `${evidence.observations.baselineReview.resolved} resolved`}`,
    `- Test-data hygiene: ${evidence.observations.testDataHygiene.available ? `${countOrUnavailable(evidence.observations.testDataHygiene.reviewRequired)} review required; ${countOrUnavailable(evidence.observations.testDataHygiene.synthetic)} synthetic; ${countOrUnavailable(evidence.observations.testDataHygiene.unassessed)} unassessed` : "unavailable"}`,
    "",
    "### Observed categories",
    "",
    "| Category | Source observations | Flow occurrences |",
    "| --- | ---: | ---: |",
  );
  if (evidence.observations.categories.length === 0) {
    lines.push("| None observed | 0 | 0 |");
  } else {
    for (const category of evidence.observations.categories) {
      lines.push(
        `| ${markdownText(category.category)} | ${category.sourceObservations} | ${category.flowOccurrences} |`,
      );
    }
  }
  lines.push(
    "",
    "### Observed external recipients",
    "",
    "| Recipient origin | Host | Categories | Flow occurrences |",
    "| --- | --- | --- | ---: |",
  );
  if (evidence.observations.externalRecipients.length === 0) {
    lines.push("| None observed | — | — | 0 |");
  } else {
    for (const recipient of evidence.observations.externalRecipients) {
      lines.push(
        `| ${markdownText(recipient.origin)} | ${markdownText(recipient.host)} | ${recipient.categories.map(markdownText).join(", ")} | ${recipient.flowOccurrences} |`,
      );
    }
  }
  lines.push(
    "",
    "### Observed rules",
    "",
    "| Rule | Observation | Occurrences | Technical failures | Review required |",
    "| --- | --- | ---: | ---: | ---: |",
  );
  if (evidence.observations.rules.length === 0) {
    lines.push("| None observed | — | 0 | 0 | 0 |");
  } else {
    for (const rule of evidence.observations.rules) {
      lines.push(
        `| ${rule.ruleId} — ${markdownText(rule.title)} | ${markdownText(rule.observation)} | ${rule.occurrences} | ${rule.technicalFailures} | ${rule.reviewRequired} |`,
      );
    }
  }

  lines.push("", "## 2. Coverage and technical limitations", "");
  const responseCoverage = evidence.coverage.firstPartyJsonResponses;
  if (responseCoverage.available) {
    const response = responseCoverage.details;
    lines.push(
      "Experimental first-party JSON response coverage:",
      "",
      `- Tests: ${response.tests.enabled} enabled; ${response.tests.disabled} disabled; ${response.tests.unavailable} unavailable`,
      `- Responses: ${response.responses.seen} seen; ${response.responses.firstParty} first party; ${response.responses.json} JSON; ${response.responses.parsed} parsed; ${response.responses.withSources} with supported sources`,
      `- Discovered response sources: ${response.discoveredSources.total}`,
      `- Retained response bytes: ${response.retainedBytes}`,
      `- Skips: unknown length=${response.skipped.unknownLength}; oversized=${response.skipped.oversized}; aggregate limit=${response.skipped.aggregateLimit}; work limit=${response.skipped.workLimit}; body read error=${response.skipped.bodyReadError}; invalid JSON=${response.skipped.invalidJson}; traversal limit=${response.skipped.traversalLimit}; source limit=${response.skipped.sourceLimit}`,
      "",
    );
  } else {
    lines.push("Experimental first-party JSON response coverage: unavailable.", "");
  }
  lines.push(
    `Diagnostics: ${evidence.coverage.diagnosticCount}`,
    `Integration errors: ${evidence.coverage.integrationErrorCount}`,
    "",
  );
  for (const limitation of evidence.limitations.coverage) {
    lines.push(`- ${markdownText(limitation)}`);
  }

  lines.push(
    "",
    "## 3. Technical-control relevance",
    "",
    "These relationships connect an observed technical fact to a technical control. Applicability caveats remain part of the evidence.",
    "",
    "| Rule | Control | Relationship | Rationale | Applicability caveat | Source |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  let technicalRows = 0;
  for (const relevance of evidence.technicalRelevance) {
    for (const control of relevance.controls) {
      technicalRows += 1;
      lines.push(
        `| ${relevance.ruleId} | ${markdownText(`${control.framework} ${control.version} ${control.control}`)} | ${control.relationship.toUpperCase()} | ${markdownText(control.rationale)} | ${markdownText(control.applicabilityCaveat)} | ${markdownText(control.sourceUrl)} |`,
      );
    }
  }
  if (technicalRows === 0) lines.push("| None included | — | — | — | — | — |");
  mappingLimitations(lines, evidence.technicalRelevance);

  lines.push(
    "",
    "## 4. Regulatory relevance",
    "",
    "Regulatory relevance is contextual or supporting evidence only. The observed technical fact remains separate from applicability and legal interpretation.",
    "",
    "| Rule/profile | Instrument and provision | Relationship | Rationale | Applicability caveat | Primary source |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  let regulatoryRows = 0;
  for (const relevance of evidence.regulatoryRelevance.rules) {
    for (const mapping of relevance.mappings) {
      regulatoryRows += 1;
      lines.push(
        `| ${relevance.ruleId} | ${markdownText(`${mapping.instrument} ${mapping.provision}`)} | ${mapping.relationship.toUpperCase()} | ${markdownText(mapping.rationale)} | ${markdownText(mapping.applicabilityCaveat)} | ${markdownText(mapping.sourceUrl)} |`,
      );
    }
  }
  for (const relevance of evidence.regulatoryRelevance.reportLevel) {
    for (const mapping of relevance.mappings) {
      regulatoryRows += 1;
      lines.push(
        `| ${markdownText(relevance.profileId)} | ${markdownText(`${mapping.instrument} ${mapping.provision}`)} | ${mapping.relationship.toUpperCase()} | ${markdownText(mapping.rationale)} | ${markdownText(mapping.applicabilityCaveat)} | ${markdownText(mapping.sourceUrl)} |`,
      );
    }
  }
  if (regulatoryRows === 0) lines.push("| None included | — | — | — | — | — |");
  mappingLimitations(lines, [
    ...evidence.regulatoryRelevance.rules,
    ...evidence.regulatoryRelevance.reportLevel.map((mapping) => ({
      ruleId: mapping.profileId,
      limitations: mapping.limitations,
    })),
  ]);

  lines.push("", "## 5. Legal and evidence limitations", "");
  for (const limitation of evidence.limitations.legal) {
    lines.push(`- ${markdownText(limitation)}`);
  }
  return `${lines.join("\n")}\n`;
};

export const renderPrivacySpecEvidence = (
  evidence: PrivacySpecEvidence,
  format: EvidenceFormat,
): string =>
  format === "json" ? `${JSON.stringify(evidence, null, 2)}\n` : renderEvidenceMarkdown(evidence);
