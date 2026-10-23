# Test AI Todo Google Runtime Inventory

Status: K4 baseline, report-only

Baseline: `b73d7a7319437860851c177c214c6e96fcaa76f7` (taken on the then-integration branch
`integration/paperclip`, since retired — `main` is now the development branch)

Checker: `scripts/check-no-google-runtime.mjs`

## Contract

`pnpm check:no-google-runtime` scans every Git-tracked regular file. It checks both path names and file contents, so manifests, source, Dockerfiles, workflows, active documentation, environment-variable names, and committed compiled assets use one inventory contract.

K4 mode is deliberately `report`. Findings print in deterministic path order and process exit status remains `0`. K12 owns removal of remaining runtime paths and switching this contract to blocking mode. Scanner or Git failures still return non-zero because an unreadable inventory is not a valid report.

Each reported path receives one classification:

| Classification | Meaning | Required action |
| --- | --- | --- |
| `remove` | Runtime, build, test, manifest, configuration, workflow, or asset contains Google, Firebase, or Gemini coupling. | Delete dependency or feature and update references. |
| `replace` | Active human/agent documentation or template advertises or loads Google/Firebase/Gemini behavior. | Rewrite for Hermes-only runtime and vendor-neutral tooling. |
| `historical-allowlist` | Immutable dated plan, release note, skill release snapshot, or changelog records past behavior. | Preserve as history; do not execute or treat as active guidance. |

The checker output is the path-level inventory. It classifies every current hit and prints terms and match counts, avoiding a second manually maintained path list that can drift.

## K4 baseline report

Command:

```sh
pnpm check:no-google-runtime
```

Observed on K4 baseline:

- mode: `report`
- forbidden paths: `194`
- historical-allowlist paths: `18`
- exit status with findings: `0`
- tracked compiled-asset findings: none on this baseline; fixture coverage proves committed `dist/assets/*` files are scanned

Current forbidden path families:

| Surface | Classification | Current path families | K12 disposition |
| --- | --- | --- | --- |
| Gemini adapter | `remove` | `packages/adapters/gemini-local/**`, adapter registries, adapter contracts/tests, CLI/UI adapter wiring | Remove Gemini adapter and all registrations. Hermes adapters remain. |
| Google Sheets connection | `remove` | `packages/google-sheets-mcp-server/**`, generated app definitions, tool-access services/routes, app UI/tests/stories | Remove Google-specific MCP runtime and connection gallery wiring. |
| Runtime images | `remove` | `Dockerfile`, `docker/agent-runtime/Dockerfile.gemini`, `docker/agent-runtime/buildx-bake.hcl`, image workflow | Stop installing, building, publishing, or signing Gemini runtime images. |
| Manifests and lock data | `remove` | root/workspace `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` references through affected packages, release package manifest, root `tsconfig.json`, `vitest.config.ts` | Remove packages/dependencies and regenerate owned metadata through repository tooling. |
| Backend/shared runtime | `remove` | `server/src/**`, `packages/adapter-utils/**`, `packages/shared/**`, selected plugins | Remove Google/Gemini enums, execution paths, secrets/env contracts, generated definitions, and tests. |
| Frontend runtime | `remove` | `ui/src/**`, `ui/storybook/**`, `ui/package.json` | Remove Gemini onboarding/config and Google Sheets UI; retain generic secret-pattern protection without vendor runtime. |
| CI and developer tooling | `remove` | `.github/workflows/**`, `.github/scripts/**`, Docker/Chrome and eval configuration, helper scripts | Replace Google Chrome invocation with vendor-neutral browser tooling and remove Gemini build/eval lanes. |
| Active product/deploy docs | `replace` | `README.md`, `cli/README.md`, `doc/*.md`, `doc/connections/**`, `docs/adapters/**`, `docs/deploy/**`, active skill docs/templates | Document Hermes-only AI runtime and remove active Google service guidance. |
| Active agent/issue templates | `replace` or `remove` by file type | `.agents/**`, `.github/ISSUE_TEMPLATE/**`, `.github/PULL_REQUEST_TEMPLATE.md` | Remove Gemini examples and externally loaded Google Fonts. |
| Compiled assets | `remove` | Any future tracked `dist/**`, `build/**`, bundle, generated HTML, or source map hit | Delete/rebuild without forbidden terms before blocking mode. |

Use checker output, not this family summary, when assigning individual files. Example:

```text
- [remove] packages/adapters/gemini-local/package.json
- [remove] packages/google-sheets-mcp-server/package.json
- [remove] docker/agent-runtime/Dockerfile.gemini
- [replace] docs/adapters/gemini-local.md
```

## Historical allowlist

Allowlist is path-scoped, not term-scoped. No source, manifest, workflow, Dockerfile, active document, or compiled asset is allowed.

| Pattern | Reason |
| --- | --- |
| `doc/plans/**` | Dated upstream design records; historical evidence, not runtime guidance. |
| `releases/**` | Published release history. |
| `skills-releases/**` | Versioned skill snapshots retained for release reproducibility. |
| `**/CHANGELOG.md` | Published package history. |

K4 baseline reports 18 allowlisted paths: 5 dated plans, 9 release notes, 2 skill release snapshots, and 2 changelogs. Any new hit outside these exact patterns is forbidden. Checker implementation, checker tests, and this inventory file are control documents excluded from self-matching; that exclusion cannot hide product/runtime files.

## Verification

```sh
pnpm test:check-no-google-runtime
pnpm check:no-google-runtime
```

Tests cover report-mode exit behavior, source and manifest hits, environment names in active docs, path-name hits, committed compiled assets, and narrow historical allowlisting. CI runs both commands as reporting steps in `.github/workflows/pr.yml`; findings remain non-blocking until K12.
