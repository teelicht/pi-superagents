# Release Process

This guide describes how maintainers publish `@teelicht/pi-superagents` through GitHub Releases and npm Trusted Publishing.

## Release Model

Releases are driven by a published GitHub Release. The release must use a git tag named `vX.Y.Z`, and that tag must match the version in `package.json`.

The project does not currently produce a compiled build artifact. The package ships TypeScript source and runtime assets directly, so the release gate uses `npm pack --dry-run --json` to verify the npm tarball contents instead of running a separate build.

## One-time npm Setup

Configure npm Trusted Publishing before publishing the first release:

1. Open the npm package settings for `@teelicht/pi-superagents`.
2. Add a trusted publisher for GitHub Actions.
3. Use organization/user `teelicht`.
4. Use repository `pi-superagents`.
5. Use workflow filename `release.yml`.
6. Leave environment name empty unless the workflow is later updated to use a GitHub deployment environment.

The workflow relies on GitHub OIDC through `id-token: write`; no long-lived `NPM_TOKEN` secret is required.

## Prepare a Release

1. Start from an up-to-date `main` branch.
2. Choose the next semantic version.
3. Update `package.json` and `package-lock.json` to the same version.
4. Add a matching entry to `CHANGELOG.md`.
5. Run the local release checks:

```bash
npm install
npm run typecheck
npx biome check .
npm run test:all
npm pack --dry-run --json
```

6. Commit the version and changelog changes.
7. Push the commit to `main`.

## Publish a Release

Create and publish a GitHub Release from the `main` commit:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

Then draft a GitHub Release for the same tag. Use the `CHANGELOG.md` entry as the release notes, or use GitHub's generated notes and then edit them for clarity.

When the GitHub Release is published, `.github/workflows/release.yml` runs these gates before npm publish:

- install dependencies with `npm install`
- verify the tag matches `package.json`
- run typecheck, lint, all tests, and package-content verification
- publish normal releases to npm with the `latest` dist-tag
- publish GitHub prereleases to npm with the `next` dist-tag

## Recovery Notes

If the workflow fails before the `Publish to npm` step, fix the issue and rerun the workflow from GitHub Actions.

If npm publish succeeds but the GitHub Release notes need editing, update the GitHub Release in place. Do not move the tag for an already published npm version.

If an incorrect package version is published, npm versions are immutable. Publish a new patch version with a correction and document the mistake in `CHANGELOG.md`.

## References

- [GitHub Releases documentation](https://docs.github.com/articles/creating-releases)
- [npm Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers)
