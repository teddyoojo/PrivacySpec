# Maintainer release process

PrivacySpec uses npm prereleases during public validation. Consumers should select `beta`
explicitly. During the 0.1.0 beta series, `beta` and `latest` both point to the current prerelease;
this does not make the prerelease stable. Once a stable version exists, `latest` must point to that
stable line and later prereleases must continue to use `beta`.

## Trusted publisher

The package already exists. Configure its npm trusted publisher with:

- GitHub owner `teddyoojo`;
- repository `PrivacySpec`;
- workflow filename `publish.yml`;
- allowed action `npm stage publish` only.

The workflow has `id-token: write` and uses a GitHub-hosted runner. It does not use a traditional
npm publishing token.

## Prepare and validate a beta

Update the package version, tool version constant, tests, changelog, and release-facing docs. Then
validate the exact clean public tree:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm format:check
pnpm build
pnpm test
cd packages/privacyspec
npm pack --dry-run --json
```

Inspect and scan the exact tarball, then smoke-install it with both the minimum supported
Playwright version and the pinned development version.

## Stage and approve

Commit the reviewed public tree and push an annotated `v<version>` tag. A beta tag triggers the
manual-capable **Stage npm release** workflow. The workflow reruns validation, stages the package
with the immutable npm `beta` tag, and creates the GitHub prerelease from the pushed tag.

Staging does not publish the package. A maintainer must inspect the staged tarball and approve it
with npm 2FA. After approval, align the default tag for the 0.1.0 beta series:

```bash
npm dist-tag add @privacyspec/playwright@<version> latest
```

Verify `npm view @privacyspec/playwright dist-tags versions --json`, install both `@beta` and the
exact version in a clean project, and compare registry integrity with the reviewed tarball.

Never publish from an uncommitted worktree, reuse a version, accept a PrivacySpec baseline in a
release job, or add direct publication to ordinary pull-request CI.
