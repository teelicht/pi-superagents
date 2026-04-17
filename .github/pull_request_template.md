# Pull request template for pi-superagents contributors.
#
# Responsibilities:
# - collect scope, validation, documentation, and release-impact details
# - remind contributors to keep package and user docs aligned
# - keep release-relevant changes visible before merge

## Summary

Describe what this PR changes and why.

## Type of Change

- [ ] feat (new behavior)
- [ ] fix (bug fix)
- [ ] docs (documentation only)
- [ ] refactor (no behavior change)
- [ ] test (test-only changes)
- [ ] chore (maintenance)

## Changes

-
-
-

## Validation

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npx biome check .`
- [ ] `npm run test:all`
- [ ] `npm pack --dry-run --json`
- [ ] Manual Pi install/smoke test performed, if applicable

## Documentation

- [ ] `README.md` updated for user-facing changes
- [ ] `docs/configuration.md` updated, if configuration behavior changed
- [ ] `docs/worktrees.md` updated, if worktree behavior changed
- [ ] `docs/parameters.md` updated, if tool parameters changed
- [ ] `docs/skills.md` updated, if skill loading or policy changed
- [ ] `CHANGELOG.md` updated for release-relevant changes

## Release Impact

- [ ] No release impact
- [ ] Patch release
- [ ] Minor release
- [ ] Major/pre-1.0 breaking release
- [ ] Requires npm Trusted Publishing or GitHub release setup changes

## Checklist

- [ ] Changes are scoped and focused
- [ ] No secrets/private data introduced
- [ ] Cross-links and paths in docs are valid
- [ ] Breaking changes are clearly called out

## Related Issues

Closes #<issue-number>
