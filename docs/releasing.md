# Release process

PrivacySpec has a public 0.x beta. The current release is tagged `v0.1.0-beta.3`, the package is
`@privacyspec/playwright@0.1.0-beta.3`, and the public repository is
[`teddyoojo/PrivacySpec`](https://github.com/teddyoojo/PrivacySpec). Install prerelease builds using
the explicit beta channel:

```bash
npm i -D @privacyspec/playwright@beta
```

For the 0.1.0 beta series, both the `beta` and `latest` dist-tags point to the current prerelease.
Documentation advertises `@beta` so consumers do not accidentally opt into a
future stable channel or mistake the current contracts for stable ones.

## Trusted publisher

The npm trusted publisher is scoped to GitHub owner `teddyoojo`, repository `PrivacySpec`, workflow
`publish.yml`, and the `npm stage publish` action only. The public workflow uses a GitHub-hosted
runner with `id-token: write`; it does not use a traditional npm publishing token.

## Current release contract

- Project, package, and CLI names are `PrivacySpec`, `@privacyspec/playwright`, and `privacyspec`.
- Source and package license are Apache-2.0.
- The root workspace remains private because it is not an npm package; the package manifest is
  publishable and identifies version `0.1.0-beta.3`.
- Playwright `>=1.58.1 <2` is the supported peer range; 1.58.1 and the pinned 1.62.1 development
  version are acceptance targets.
- Report v5, attachment v5, run-part v3, privacy baseline/latest-run v2, and inventory/evidence v2
  are current. Strict readers retain report v1–v5, attachment v1–v5, run-part v1–v3, privacy
  baseline/latest v1–v2, and inventory/evidence v1–v2. Legacy attachment v1–v4 and run-part v1/v2
  classifier state is unavailable; mixed run-part versions and mismatched current classifier state
  reject. Test-data, storage-state,
  dependency/security/runtime and analyzer artifacts, and proposals retain schema v1. Fixture
  composition, reporter options, stable rule IDs, and existing CLI behavior remain beta
  compatibility constraints.
- Custom classifier integrations must supply a semantic configuration ID. Candidate review must
  verify the migration, the distinction from `runScope.configurationId`, fixed non-echoing errors,
  mismatch suppression, and the absence of matcher tables/digests from every persisted surface.
- Chromium remains supported. Firefox, WebKit, and composed `request` observation remain explicit
  experiments and require controlled minimum/current Playwright compatibility evidence before any
  separate stable-promotion decision.
- Publishing a later version, changing a dist-tag, creating a GitHub release, or transferring the
  repository always requires a separate explicit decision. Implementation phases do not authorize
  those external actions.

## Preparing a later beta

1. Select an unused prerelease version and record user approval for publication and dist-tag
   changes.
2. Review public metadata, repository links, package README, API docs, security policy, changelog,
   and migration notes.
3. Run `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build`, and `pnpm test` on the pinned
   environment.
4. Run `npm pack --dry-run --json` from `packages/privacyspec` and verify that only compiled
   `dist/`, package metadata, README, and license files are present.
5. Install the exact tarball into clean Playwright 1.58.1 and 1.62.1 fixtures and run smoke suites.
6. Scan the tarball and generated artifacts for raw fixture values and prohibited payload fields.
7. Review the complete schema compatibility matrix, custom-classifier migration, exact artifact
   readers, and bounded API-request object processing; document any explicitly approved migration.
8. Push the reviewed public commit and annotated version tag. The public `publish.yml` workflow
   stages the package with npm trusted publishing and the explicit `beta` tag.
9. Inspect and approve the staged package with npm 2FA, align the approved `latest` dist-tag, and
   verify registry integrity, the beta install command, repository links, and release notes.

An npm version is immutable and cannot be reused with different contents. Never run package
publication, npm dist-tag mutation, GitHub release creation, repository transfer, or baseline
acceptance as an implicit CI or implementation step. CI validation remains read-only.
