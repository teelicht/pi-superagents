# General Development Rules

- NEVER adapt skill files directly!

# Language Standard (TypeScript Required)

- Use TypeScript for all application code.
- Do not add new plain JavaScript source files for backend, mobile, or shared packages.
- Prefer `.ts` / `.tsx` and shared typed contracts over untyped code.
- If JavaScript is unavoidable (for example, tool-specific config files), keep it minimal and document the reason in the relevant spec/plan artifact.

## TypeScript development/testing/linting libraries (mandatory baseline)

These are required to satisfy the TypeScript-first and quality-gate requirements:

- TypeScript compiler/tooling: `typescript`, `tsx`, `@types/node`
- Linting: `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`
- Formatting: `prettier`, `eslint-config-prettier`
- Backend/shared testing: `vitest`, `@vitest/coverage-v8`, `supertest`

# Documentation Rules

Every source file and every non-trivial function must include documentation headers.

## File header (required)

Add a short header at the top of each file describing:

- module purpose
- key responsibilities
- important dependencies or side effects

## Function header (required)

Use doc comments (for example TSDoc/JSDoc) for each function:

- what it does
- inputs/outputs
- invariants or constraints
- notable errors/failure modes

Keep comments precise and maintained with code changes.

## User Documentation

- After each change, make sure that the user documentation is updated:
  - `README.md`
  - `docs/guides/superpowers.md`
  - `docs/reference/worktrees.md`
  - `docs/reference/configuration.md`
  - `docs/reference/parameters.md`
  - `docs/reference/skills.md`
