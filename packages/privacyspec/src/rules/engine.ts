import type { DataFlow } from "../correlate/model.js";
import { getDataCategoryFamily } from "../discovery/source-model.js";
import { RULE_DEFINITIONS } from "./definitions.js";
import type {
  Finding,
  FindingClassification,
  FindingSeverity,
  RuleEvaluationConfig,
  RuleId,
} from "./model.js";

const storageSinkKinds = new Set<DataFlow["sinkKind"]>([
  "local-storage",
  "session-storage",
  "cookie",
]);

const isHighConfidence = (flow: DataFlow): boolean => flow.sourceConfidence === "high";

const isPersonalData = (flow: DataFlow): boolean =>
  getDataCategoryFamily(flow.dataCategory) === "personal";

const isSecret = (flow: DataFlow): boolean => getDataCategoryFamily(flow.dataCategory) === "secret";

// Do not let future secret categories silently become PS1005 failures. ASVS V14.3.3
// excepts session tokens, so each automatically failing storage category must be
// positively identified and added here deliberately.
const isUnambiguouslyDisallowedStoredSecret = (flow: DataFlow): boolean =>
  flow.dataCategory === "secret.password";

const isExternalRequest = (flow: DataFlow): boolean =>
  flow.sinkKind === "external-request" && flow.recipient?.firstParty === false;

const isUrlFlow = (flow: DataFlow): boolean =>
  flow.sinkKind === "request-url" || flow.location?.startsWith("url.") === true;

const normalizeOrigin = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    return url.origin === "null" ? undefined : url.origin;
  } catch {
    return undefined;
  }
};

const allowedInsecureOrigins = (config: RuleEvaluationConfig): ReadonlySet<string> => {
  const origins = new Set<string>();
  for (const configured of config.allowInsecureOrigins ?? []) {
    const origin = normalizeOrigin(configured);
    if (origin !== undefined) origins.add(origin);
  }
  return origins;
};

const isUnallowedInsecureRequest = (
  flow: DataFlow,
  allowedOrigins: ReadonlySet<string>,
): boolean => {
  // Correlated final page URLs have no request method. Requiring one avoids
  // treating a history.replaceState URL as proof that a transport occurred.
  if (flow.method === undefined || flow.recipient === undefined) return false;
  const origin = normalizeOrigin(flow.recipient.origin);
  if (origin === undefined || allowedOrigins.has(origin)) return false;
  return new URL(origin).protocol === "http:";
};

const finding = (
  ruleId: RuleId,
  severity: FindingSeverity,
  classification: FindingClassification,
  observation: string,
  flow: DataFlow,
  limitations: string[] = [],
): Finding => ({
  kind: "finding",
  ruleId,
  severity,
  classification,
  title: RULE_DEFINITIONS[ruleId].title,
  observation,
  flow,
  limitations,
});

const evaluateFlow = (flow: DataFlow, allowedOrigins: ReadonlySet<string>): Finding[] => {
  const findings: Finding[] = [];
  const highConfidence = isHighConfidence(flow);

  if (highConfidence && isUrlFlow(flow)) {
    const personalData = isPersonalData(flow);
    findings.push(
      finding(
        "PS1001",
        personalData ? "warning" : "error",
        personalData ? "review_required" : "technical_failure",
        `High-confidence ${flow.dataCategory} was observed in a URL.`,
        flow,
        personalData
          ? [
              "Personal data is not automatically classified as sensitive under the application's ASVS protection requirements.",
            ]
          : [],
      ),
    );
  }

  if (highConfidence && isUnallowedInsecureRequest(flow, allowedOrigins)) {
    findings.push(
      finding(
        "PS1002",
        "error",
        "technical_failure",
        `High-confidence ${flow.dataCategory} was observed in a network request over insecure HTTP.`,
        flow,
        ["Local-development origins are excluded only when explicitly configured."],
      ),
    );
  }

  if (highConfidence && isSecret(flow) && isExternalRequest(flow)) {
    findings.push(
      finding(
        "PS1003",
        "critical",
        "technical_failure",
        `High-confidence ${flow.dataCategory} was observed leaving the configured first-party boundary.`,
        flow,
      ),
    );
  }

  if (isPersonalData(flow) && isExternalRequest(flow)) {
    findings.push(
      finding(
        "PS1004",
        "warning",
        "review_required",
        `${flow.dataCategory} was observed leaving the configured first-party boundary.`,
        flow,
        [
          "PrivacySpec cannot determine processor status, lawful basis, necessity, purpose compatibility, or contractual safeguards.",
        ],
      ),
    );
  }

  if (storageSinkKinds.has(flow.sinkKind)) {
    if (isPersonalData(flow)) {
      findings.push(
        finding(
          "PS1005",
          "warning",
          "review_required",
          `${flow.dataCategory} was observed in browser storage.`,
          flow,
          ["Browser storage may be necessary; the processing context requires review."],
        ),
      );
    } else if (highConfidence && isUnambiguouslyDisallowedStoredSecret(flow)) {
      findings.push(
        finding(
          "PS1005",
          "critical",
          "technical_failure",
          `High-confidence ${flow.dataCategory} was observed in browser storage.`,
          flow,
          [
            "The current prototype's automatic critical storage category is secret.password; it has no session- or API-token classifier.",
          ],
        ),
      );
    }
  }

  if (highConfidence && flow.sinkKind === "console") {
    findings.push(
      finding(
        "PS1006",
        isSecret(flow) ? "critical" : "error",
        "technical_failure",
        `High-confidence ${flow.dataCategory} was observed in browser console output.`,
        flow,
        ["PrivacySpec cannot determine whether the console output is retained or exported."],
      ),
    );
  }

  return findings;
};

export const evaluateDataFlows = (
  flows: readonly DataFlow[],
  config: RuleEvaluationConfig = {},
): Finding[] => {
  const allowedOrigins = allowedInsecureOrigins(config);
  const findings = new Map<string, Finding>();
  for (const flow of flows) {
    for (const result of evaluateFlow(flow, allowedOrigins)) {
      findings.set(JSON.stringify([result.ruleId, result.flow]), result);
    }
  }
  return Array.from(findings.values());
};
