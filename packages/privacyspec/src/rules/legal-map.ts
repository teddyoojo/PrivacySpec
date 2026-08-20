import type { RuleId } from "./model.js";

export type MappingRelationship = "direct" | "contextual" | "supporting_evidence";

export interface TechnicalControlMapping {
  readonly framework: "OWASP ASVS";
  readonly version: "5.0.0";
  readonly control: string;
  readonly requirementId: string;
  readonly relationship: "direct" | "contextual";
  readonly rationale: string;
  readonly applicabilityCaveat: string;
  readonly sourceUrl: string;
  readonly lastReviewed: string;
}

export interface RegulatoryMapping {
  readonly instrument: string;
  readonly provision: string;
  readonly relationship: "contextual" | "supporting_evidence";
  readonly rationale: string;
  readonly applicabilityCaveat: string;
  readonly sourceType: "primary";
  readonly sourceUrl: string;
  readonly lastReviewed: string;
}

export interface RuleLegalMapping {
  readonly ruleId: RuleId;
  readonly observationRule: string;
  readonly technicalControls: readonly TechnicalControlMapping[];
  readonly regulatoryRelevance: readonly RegulatoryMapping[];
  readonly limitations: readonly string[];
}

export interface ReportLevelLegalMapping {
  readonly profileId: "nis2_2024_2690";
  readonly title: string;
  readonly observation: string;
  readonly regulatoryRelevance: readonly RegulatoryMapping[];
  readonly limitations: readonly string[];
}

export interface ReportLevelMappings {
  readonly nis2_2024_2690: ReportLevelLegalMapping;
}

const LAST_REVIEWED = "2026-08-20";
const ASVS_V12_SOURCE =
  "https://github.com/OWASP/ASVS/blob/v5.0.0_release/5.0/en/0x21-V12-Secure-Communication.md";
const ASVS_V14_SOURCE =
  "https://github.com/OWASP/ASVS/blob/v5.0.0_release/5.0/en/0x23-V14-Data-Protection.md";
const ASVS_V16_SOURCE =
  "https://github.com/OWASP/ASVS/blob/v5.0.0_release/5.0/en/0x25-V16-Security-Logging-and-Error-Handling.md";
const GDPR_SOURCE = "https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng";
const NIS2_IMPLEMENTING_REGULATION_SOURCE =
  "https://eur-lex.europa.eu/eli/reg_impl/2024/2690/oj/eng";

const technicalControl = (
  control: string,
  relationship: TechnicalControlMapping["relationship"],
  rationale: string,
  applicabilityCaveat: string,
  sourceUrl: string,
): TechnicalControlMapping =>
  Object.freeze({
    framework: "OWASP ASVS",
    version: "5.0.0",
    control,
    requirementId: `v5.0.0-${control.slice(1)}`,
    relationship,
    rationale,
    applicabilityCaveat,
    sourceUrl,
    lastReviewed: LAST_REVIEWED,
  });

const gdpr = (
  provision: string,
  rationale: string,
  applicabilityCaveat: string,
): RegulatoryMapping =>
  Object.freeze({
    instrument: "GDPR",
    provision,
    relationship: "contextual",
    rationale,
    applicabilityCaveat,
    sourceType: "primary",
    sourceUrl: GDPR_SOURCE,
    lastReviewed: LAST_REVIEWED,
  });

const ruleMapping = (
  ruleId: RuleId,
  observationRule: string,
  technicalControls: readonly TechnicalControlMapping[],
  regulatoryRelevance: readonly RegulatoryMapping[],
  limitations: readonly string[],
): RuleLegalMapping =>
  Object.freeze({
    ruleId,
    observationRule,
    technicalControls: Object.freeze([...technicalControls]),
    regulatoryRelevance: Object.freeze([...regulatoryRelevance]),
    limitations: Object.freeze([...limitations]),
  });

const gdprSecurityApplicability =
  "Relevant only when the observed value is personal data and the GDPR applies; PrivacySpec does not assess the risk-appropriate technical and organisational measures as a whole.";
const gdprDesignApplicability =
  "Relevant only where GDPR controller obligations apply; appropriate measures depend on the purposes, context, risks, state of the art, and implementation cost.";
const gdprMinimisationApplicability =
  "Relevant only when the observed value is personal data and the GDPR applies; necessity depends on the specific processing purpose and context.";

export const RULE_LEGAL_MAPPINGS: Readonly<Record<RuleId, RuleLegalMapping>> = Object.freeze({
  PS1001: ruleMapping(
    "PS1001",
    "Reports a high-confidence personal-data or secret value observed in a request URL or an observable page URL.",
    [
      technicalControl(
        "V14.2.1",
        "contextual",
        "When the observed value is classified as sensitive under the application's documented protection requirements, this observation directly relates to V14.2.1. For ordinary personal data such as email or phone, the relationship is contextual.",
        "PrivacySpec infers a data category, not the application's ASVS protection classification. A fragment or page-history URL can also be observed without being transmitted to a server.",
        ASVS_V14_SOURCE,
      ),
    ],
    [
      gdpr(
        "Article 5(1)(f)",
        "Exposure through URL surfaces can be relevant to the integrity and confidentiality principle.",
        gdprSecurityApplicability,
      ),
      gdpr(
        "Article 25(1)",
        "Keeping personal data out of unnecessarily exposed URL surfaces can support safeguards by design.",
        gdprDesignApplicability,
      ),
      gdpr(
        "Article 32(1)(b) and 32(2)",
        "The observation can be relevant to confidentiality risks affecting transmitted or otherwise processed personal data.",
        gdprSecurityApplicability,
      ),
    ],
    [
      "The displayed default outcome applies to ordinary personal data; a high-confidence secret in a URL is an error-level technical failure.",
      "Direct ASVS applicability requires the application to classify the observed value as sensitive under its documented protection requirements.",
      "The specific URL restriction comes from the technical control; the GDPR does not categorically prohibit all personal data in URLs.",
      "PrivacySpec does not determine whether a regulatory requirement is satisfied or infringed.",
    ],
  ),
  PS1002: ruleMapping(
    "PS1002",
    "Reports a high-confidence sensitive value observed in an HTTP request to an origin that is not an explicitly allowed local-development origin.",
    [
      technicalControl(
        "V12.2.1",
        "direct",
        "This control directly requires TLS for client connectivity to external-facing HTTP services without insecure fallback.",
        "PrivacySpec detects the observed HTTP transport but does not assess the service's complete TLS configuration or deployment context.",
        ASVS_V12_SOURCE,
      ),
    ],
    [
      gdpr(
        "Article 5(1)(f)",
        "Cleartext transport of personal data can be relevant to the integrity and confidentiality principle.",
        gdprSecurityApplicability,
      ),
      gdpr(
        "Article 32(1) and 32(2)",
        "Transport protection can be relevant to risk-appropriate security measures and unauthorized-disclosure risk.",
        gdprSecurityApplicability,
      ),
    ],
    [
      "Article 32 is risk-based and does not itself name HTTP or TLS; the HTTP observation is the technical fact.",
      "Explicit local-development exceptions suppress this rule and must not be treated as production approval.",
    ],
  ),
  PS1003: ruleMapping(
    "PS1003",
    "Reports a high-confidence secret observed in a request outside the configured first-party boundary.",
    [
      technicalControl(
        "V14.2.3",
        "contextual",
        "This control addresses defined sensitive data sent to untrusted parties.",
        "A non-first-party origin is not automatically untrusted under ASVS; PrivacySpec's always-fail treatment of external secret flow is product policy.",
        ASVS_V14_SOURCE,
      ),
    ],
    [
      gdpr(
        "Article 5(1)(f)",
        "Disclosure of a password associated with an identifiable person can be relevant to integrity and confidentiality.",
        "Relevant only where the secret relates to personal data and the GDPR applies; recipient authorization and actual disclosure risk require additional context.",
      ),
      gdpr(
        "Article 25(1)",
        "Preventing secrets from crossing unintended trust boundaries can support safeguards by design.",
        "Relevant only where the secret is personal data and GDPR controller obligations apply; appropriate measures depend on the purposes, context, risks, state of the art, and implementation cost.",
      ),
      gdpr(
        "Article 32(1)(b) and 32(2)",
        "The observation can be relevant to confidentiality and unauthorized-disclosure risks.",
        gdprSecurityApplicability,
      ),
    ],
    [
      "External does not by itself establish that a recipient is untrusted, unauthorized, or a GDPR third party.",
      "PrivacySpec does not determine controller or processor roles, contractual safeguards, or legal consequences.",
    ],
  ),
  PS1004: ruleMapping(
    "PS1004",
    "Reports personal data observed in a request outside the configured first-party boundary.",
    [
      technicalControl(
        "V14.2.3",
        "contextual",
        "This control addresses defined sensitive data sent to untrusted parties.",
        "External is not synonymous with untrusted; recipient authorization and trust require project context.",
        ASVS_V14_SOURCE,
      ),
    ],
    [
      gdpr(
        "Article 5(1)(c)",
        "A newly observed external personal-data flow can be relevant when assessing whether processing is limited to what is necessary.",
        gdprMinimisationApplicability,
      ),
      gdpr(
        "Article 5(1)(f)",
        "The flow can be relevant to confidentiality when recipient authorization or safeguards are in question.",
        "Relevant only when the GDPR applies and confidentiality risk is implicated; an external origin is not automatically unauthorized.",
      ),
      gdpr(
        "Article 25(1)",
        "Reviewing new recipient flows can support effective data-protection principles and safeguards by design.",
        gdprDesignApplicability,
      ),
    ],
    [
      "PrivacySpec cannot determine processor status, lawful basis, necessity, purpose compatibility, authorization, or contractual safeguards.",
      "A new external flow is a contextual review finding, not an automatic legal conclusion.",
    ],
  ),
  PS1005: ruleMapping(
    "PS1005",
    "Reports personal data or a high-confidence password observed in browser storage.",
    [
      technicalControl(
        "V14.3.3",
        "contextual",
        "This control addresses data classified as sensitive in browser storage.",
        "The control explicitly excepts session tokens and relies on the application's sensitivity classification. PrivacySpec currently classifies only discovered password controls as secrets; it does not infer token purpose from JWT shape, cookie or storage keys, or storage location.",
        ASVS_V14_SOURCE,
      ),
    ],
    [
      gdpr(
        "Article 5(1)(c)",
        "Client-side persistence can be relevant when assessing whether the amount and extent of processing are necessary.",
        gdprMinimisationApplicability,
      ),
      gdpr(
        "Article 5(1)(f)",
        "Browser storage can affect the confidentiality of personal data accessible on a client device.",
        gdprSecurityApplicability,
      ),
      gdpr(
        "Article 25(1) and 25(2)",
        "Storage choices can be relevant to safeguards by design and by-default limits on processing and accessibility.",
        "Relevant only where GDPR controller obligations apply; Article 25(2) is relevant only to processing by default and its necessary amount, extent, storage period, and accessibility.",
      ),
      gdpr(
        "Article 32(1)(b) and 32(2)",
        "The observation can be relevant where client-side storage creates unauthorized-access or disclosure risk.",
        gdprSecurityApplicability,
      ),
    ],
    [
      "The displayed default outcome applies to personal data; a high-confidence password in browser storage is a critical technical failure.",
      "PrivacySpec has no session- or API-token classifier. Future token support must distinguish session tokens before treating API credentials in storage as automatic technical failures.",
      "Browser storage can be necessary; PrivacySpec does not determine purpose, retention, access controls, or risk appropriateness.",
      "ASVS sensitive data is an application protection classification and must not be equated with GDPR special-category data.",
    ],
  ),
  PS1006: ruleMapping(
    "PS1006",
    "Reports a high-confidence sensitive value observed in browser console output.",
    [
      technicalControl(
        "V16.2.5",
        "contextual",
        "This control addresses protection-level restrictions when sensitive data is logged.",
        "Browser console output is not necessarily a retained or broadcast security log, so the control is relevant only with additional logging context.",
        ASVS_V16_SOURCE,
      ),
      technicalControl(
        "V14.2.4",
        "contextual",
        "This control addresses implementation of defined sensitive-data protections, including how data may be logged.",
        "The application must first have documented protection requirements; PrivacySpec does not observe those requirements.",
        ASVS_V14_SOURCE,
      ),
    ],
    [
      gdpr(
        "Article 5(1)(c)",
        "Emitting personal data to diagnostic output can be relevant when assessing whether that processing is necessary.",
        gdprMinimisationApplicability,
      ),
      gdpr(
        "Article 5(1)(f)",
        "Console exposure can be relevant to confidentiality depending on audience, retention, and export behavior.",
        gdprSecurityApplicability,
      ),
      gdpr(
        "Article 25(1)",
        "Avoiding unnecessary personal data in diagnostic output can support safeguards by design.",
        gdprDesignApplicability,
      ),
      gdpr(
        "Article 32(1)(b) and 32(2)",
        "The observation can be relevant if console output creates unauthorized-access or disclosure risk.",
        gdprSecurityApplicability,
      ),
    ],
    [
      "The displayed default error severity escalates to critical for a high-confidence secret.",
      "PrivacySpec cannot determine whether console output is retained, exported, or accessible beyond the browser session.",
      "Neither mapped ASVS control categorically prohibits every browser console message.",
    ],
  ),
});

export const REPORT_LEVEL_LEGAL_MAPPINGS: Readonly<ReportLevelMappings> = Object.freeze({
  nis2_2024_2690: Object.freeze({
    profileId: "nis2_2024_2690",
    title: "Testing evidence relevance",
    observation:
      "A documented PrivacySpec run may contribute evidence about a browser-side security test and its findings.",
    regulatoryRelevance: Object.freeze([
      Object.freeze({
        instrument: "Commission Implementing Regulation (EU) 2024/2690",
        provision: "Annex, points 6.5.2(b) and 6.5.2(c)",
        relationship: "supporting_evidence",
        rationale:
          "When linked to a separately documented test methodology, the run may contribute evidence about its application and records of test scope, time, results, and finding criticality.",
        applicabilityCaveat:
          "Show only after the organisation has confirmed that the implementing regulation applies; an ordinary SaaS product is not automatically within its specified entity scope.",
        sourceType: "primary",
        sourceUrl: NIS2_IMPLEMENTING_REGULATION_SOURCE,
        lastReviewed: LAST_REVIEWED,
      }),
    ]),
    limitations: Object.freeze([
      "PrivacySpec does not establish risk-based test scope or frequency, complete component coverage, mitigating actions, periodic policy review, or satisfaction of Annex point 6.5 as a whole.",
      "This profile is testing-process evidence relevance and is not a per-finding NIS2 determination.",
    ]),
  }),
});

export const getRuleLegalMapping = (ruleId: string): RuleLegalMapping | undefined =>
  Object.hasOwn(RULE_LEGAL_MAPPINGS, ruleId) ? RULE_LEGAL_MAPPINGS[ruleId as RuleId] : undefined;
