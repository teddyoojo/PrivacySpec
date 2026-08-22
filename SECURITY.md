# Security policy

## Supported versions

The current `0.1.x` beta line and repository head receive security fixes on a best-effort basis.
There is no long-term-support commitment while the package remains in beta.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities, privacy failures, or raw sensitive artifacts in a
public issue. Use the private security-advisory flow for
[`teddyoojo/PrivacySpec`](https://github.com/teddyoojo/PrivacySpec/security/advisories/new). If that
flow is unavailable, contact the repository owner without including sensitive production data.

Include only the minimum information needed to reproduce the issue:

- affected version or commit;
- impact and attack conditions;
- a sanitized reproducer;
- whether PrivacySpec persisted or exposed data it should have kept transient.

Never attach production data, credentials, raw request bodies, or unredacted PrivacySpec test
values. Use generated fixtures and describe sensitive categories semantically.

The maintainer should acknowledge a report, establish a private coordination channel, assess
whether artifacts or published packages are affected, and agree on remediation/disclosure timing.
Concrete response-time commitments will be added only after a maintainer organisation and release
support scope are selected.

## Security boundaries

PrivacySpec processes untrusted application and test metadata. Terminal/report parsing therefore
rejects control characters and unbounded fields. Raw sensitive values are allowed only in bounded,
test-scoped browser and worker memory for correlation; their appearance in logs, attachments,
reports, baselines, snapshots, or committed fixtures is a security/privacy defect.
