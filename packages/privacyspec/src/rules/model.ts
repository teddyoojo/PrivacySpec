import type { DataFlow } from "../correlate/model.js";

export type RuleId = "PS1001" | "PS1002" | "PS1003" | "PS1004" | "PS1005" | "PS1006";

export type FindingSeverity = "info" | "warning" | "error" | "critical";

export type FindingClassification = "technical_failure" | "review_required" | "informational";

export interface Finding {
  kind: "finding";
  ruleId: RuleId;
  severity: FindingSeverity;
  classification: FindingClassification;
  title: string;
  observation: string;
  flow: DataFlow;
  limitations: string[];
}

export interface RuleEvaluationConfig {
  allowInsecureOrigins?: readonly string[] | undefined;
}
