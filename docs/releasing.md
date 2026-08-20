# Maintainer release process

PrivacySpec uses npm prereleases during public validation. Consumers should select `beta`
explicitly. npm exposes the first and only published version through its default `latest` tag as
well; this does not make the prerelease stable. Once a stable version exists, `latest` must point to
that stable line and later prereleases must continue to use `beta`.

## First beta

The first registry version must be published interactively because npm staged publishing requires
the package to exist first:

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
cd packages/privacyspec
npm pack --dry-run
npm publish --access public --tag beta
```

Verify the result from a clean project with
`pnpm add -D @privacyspec/playwright@beta`.

## Later betas

Each release requires a unique semantic version in the package manifest, source constants, tests,
and changelog. After `@privacyspec/playwright` exists, configure npm trusted publishing for:

- GitHub owner: `teddyoojo`;
- repository: `PrivacySpec`;
- workflow: `publish.yml`;
- allowed action: `npm stage publish`.

The manual **Stage npm release** workflow validates and stages the tarball. A maintainer must inspect
and approve the staged version with npm 2FA before it becomes public. Traditional npm publishing
tokens should be disabled after trusted publishing is configured.

Never publish from an uncommitted worktree, reuse a version, accept a PrivacySpec baseline in a
release job, or add direct publication to ordinary pull-request CI.
