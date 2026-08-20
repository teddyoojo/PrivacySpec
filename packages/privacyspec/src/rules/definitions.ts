import type { FindingClassification, FindingSeverity, RuleId } from "./model.js";

export interface RuleDefinition {
  id: RuleId;
  title: string;
  defaultSeverity: FindingSeverity;
  defaultClassification: FindingClassification;
}

export const RULE_DEFINITIONS: Readonly<Record<RuleId, RuleDefinition>> = Object.freeze({
  PS1001: Object.freeze({
    id: "PS1001",
    title: "Personal data or secret in URL",
    defaultSeverity: "warning",
    defaultClassification: "review_required",
  }),
  PS1002: Object.freeze({
    id: "PS1002",
    title: "Sensitive data over insecure HTTP",
    defaultSeverity: "error",
    defaultClassification: "technical_failure",
  }),
  PS1003: Object.freeze({
    id: "PS1003",
    title: "Secret sent to external recipient",
    defaultSeverity: "critical",
    defaultClassification: "technical_failure",
  }),
  PS1004: Object.freeze({
    id: "PS1004",
    title: "Personal data sent to external recipient",
    defaultSeverity: "warning",
    defaultClassification: "review_required",
  }),
  PS1005: Object.freeze({
    id: "PS1005",
    title: "Sensitive data in browser storage",
    defaultSeverity: "warning",
    defaultClassification: "review_required",
  }),
  PS1006: Object.freeze({
    id: "PS1006",
    title: "Sensitive data emitted to browser console",
    defaultSeverity: "error",
    defaultClassification: "technical_failure",
  }),
});
