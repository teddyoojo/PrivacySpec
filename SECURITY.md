# Security policy

## Supported versions

PrivacySpec is currently a public beta. Security and privacy fixes are provided for the most recent
`0.1.x` beta release only.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities, privacy failures, or raw sensitive artifacts in a
public issue. Use GitHub's private vulnerability reporting for this repository:

https://github.com/teddyoojo/PrivacySpec/security/advisories/new

Include only the minimum information needed to reproduce the issue:

- affected version or commit;
- impact and attack conditions;
- a sanitized reproducer;
- whether PrivacySpec persisted or exposed data it should have kept transient.

Never attach production data, credentials, raw request bodies, or unredacted test values. Use
generated fixtures and describe sensitive categories semantically.

The maintainer will acknowledge the report, establish a private coordination channel, assess
affected artifacts or published packages, and coordinate remediation and disclosure. Concrete
response-time guarantees are not offered during the beta.

## Security boundaries

PrivacySpec processes untrusted application and test metadata. Terminal/report parsing rejects
control characters and unbounded fields. Raw sensitive values are allowed only in bounded,
test-scoped browser and worker memory for correlation; their appearance in logs, attachments,
reports, baselines, snapshots, or committed fixtures is a security/privacy defect.
