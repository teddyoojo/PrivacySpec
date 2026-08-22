import type { SecurityRuleId } from "./model.js";

export interface SecurityTechnicalControl {
  framework: "OWASP ASVS";
  version: "5.0.0";
  control: `v5.0.0-${string}`;
  relationship: "direct" | "contextual";
  sourceUrl: string;
}

const ASVS_V3_SOURCE =
  "https://github.com/OWASP/ASVS/blob/v5.0.0_release/5.0/en/0x12-V3-Web-Frontend-Security.md";

const control = (
  requirement: string,
  relationship: SecurityTechnicalControl["relationship"],
): SecurityTechnicalControl => ({
  framework: "OWASP ASVS",
  version: "5.0.0",
  control: `v5.0.0-${requirement}`,
  relationship,
  sourceUrl: ASVS_V3_SOURCE,
});

export const SECURITY_TECHNICAL_CONTROLS: Readonly<
  Record<SecurityRuleId, readonly SecurityTechnicalControl[]>
> = Object.freeze({
  SECURITY_CSP_CHANGED: Object.freeze([control("3.4.3", "direct")]),
  SECURITY_HSTS_CHANGED: Object.freeze([control("3.4.1", "direct")]),
  SECURITY_XCTO_CHANGED: Object.freeze([control("3.4.4", "direct")]),
  SECURITY_CORS_CHANGED: Object.freeze([control("3.4.2", "contextual")]),
  SECURITY_COOKIE_CHANGED: Object.freeze([
    control("3.3.1", "contextual"),
    control("3.3.2", "contextual"),
    control("3.3.4", "contextual"),
  ]),
  SECURITY_TRANSPORT_CHANGED: Object.freeze([control("3.4.1", "contextual")]),
});
