import type {
  PrivacySpecStorageStateScan,
  StorageStateFileObservation,
  StorageStateScanFormat,
} from "./storage-state-model.js";

const fileSummary = (file: StorageStateFileObservation): string =>
  `input ${file.input}: ${file.findingStatus} / ${file.repositoryStatus} / credentials=${file.credentialEvidence.present ? "present" : "not_detected"} / cookies=${file.structure.cookieCount} / origins=${file.structure.originCount} / local_storage=${file.structure.localStorageEntryCount} / email_shapes=${file.personalDataShapes.emailValueCount} / phone_shapes=${file.personalDataShapes.phoneValueCount}`;

export const renderStorageStateScanTerminal = (scan: PrivacySpecStorageStateScan): string => {
  const lines = [
    "PrivacySpec Storage-State Hygiene Scan",
    "",
    `Scope: ${scan.scope.scannedFiles}/${scan.scope.explicitlySuppliedFiles} explicitly supplied files; repository crawl=NO; symlinks followed=NO`,
    `Findings: review_required=${scan.summary.reviewRequired}, informational=${scan.summary.informational}`,
    `Structure: credential-bearing files=${scan.summary.credentialBearingFiles}, personal-data-shaped files=${scan.summary.personalDataShapedFiles}`,
    `Git: tracked=${scan.summary.repositoryStatus.tracked}, ignored=${scan.summary.repositoryStatus.ignored}, untracked=${scan.summary.repositoryStatus.untracked}, unavailable=${scan.summary.repositoryStatus.gitUnavailable}`,
    "",
  ];
  for (const file of scan.files) lines.push(`- ${fileSummary(file)}`);
  lines.push(
    "",
    "Technical basis:",
    `- ${scan.technicalBasis.statement}`,
    `- Source: ${scan.technicalBasis.source}`,
    "",
    "Limitations:",
  );
  for (const limitation of scan.limitations) lines.push(`- ${limitation}`);
  return `${lines.join("\n")}\n`;
};

export const renderStorageStateScanMarkdown = (scan: PrivacySpecStorageStateScan): string => {
  const lines = [
    "# PrivacySpec Storage-State Hygiene Scan",
    "",
    `- Scope: ${scan.scope.scannedFiles}/${scan.scope.explicitlySuppliedFiles} explicitly supplied files`,
    `- Repository crawl: **NO**`,
    `- Symlinks followed: **NO**`,
    `- Findings: review required=${scan.summary.reviewRequired}, informational=${scan.summary.informational}`,
    `- Credential-bearing files: ${scan.summary.credentialBearingFiles}`,
    `- Personal-data-shaped files: ${scan.summary.personalDataShapedFiles}`,
    "",
    "| Input | Finding status | Git status | Credential state | Cookies | Origins | localStorage | Email shapes | Phone shapes |",
    "| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const file of scan.files) {
    lines.push(
      `| ${file.input} | ${file.findingStatus} | ${file.repositoryStatus} | ${file.credentialEvidence.present ? "present" : "not detected"} | ${file.structure.cookieCount} | ${file.structure.originCount} | ${file.structure.localStorageEntryCount} | ${file.personalDataShapes.emailValueCount} | ${file.personalDataShapes.phoneValueCount} |`,
    );
  }
  lines.push(
    "",
    "## Credential evidence",
    "",
    "| Input | Credential-named cookies | HttpOnly cookies | Credential-named localStorage entries |",
    "| ---: | ---: | ---: | ---: |",
  );
  for (const file of scan.files) {
    lines.push(
      `| ${file.input} | ${file.credentialEvidence.credentialNamedCookieCount} | ${file.credentialEvidence.httpOnlyCookieCount} | ${file.credentialEvidence.credentialNamedLocalStorageEntryCount} |`,
    );
  }
  lines.push(
    "",
    "## Technical basis",
    "",
    scan.technicalBasis.statement,
    "",
    `Source: ${scan.technicalBasis.source}`,
    "",
    "## Limitations",
    "",
  );
  for (const limitation of scan.limitations) lines.push(`- ${limitation}`);
  return `${lines.join("\n")}\n`;
};

export const renderStorageStateScan = (
  scan: PrivacySpecStorageStateScan,
  format: StorageStateScanFormat,
): string => {
  if (format === "json") return `${JSON.stringify(scan, null, 2)}\n`;
  if (format === "markdown") return renderStorageStateScanMarkdown(scan);
  return renderStorageStateScanTerminal(scan);
};
