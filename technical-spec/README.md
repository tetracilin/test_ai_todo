# technical-spec

The single home for design and technical documentation. It replaces the former `doc/` and
`docs/` folders (reconciled 2026-10-13).

| Folder | Holds |
| --- | --- |
| `product/` | Product definition and the V1 contract: `GOAL`, `PRODUCT`, `SPEC`, `SPEC-implementation`, companies spec, external task protocol |
| `architecture/` | How subsystems work: execution semantics, run lifecycle, agent runs, watchdog, deployment modes, MCP access governance, secrets provider, plugin system (`plugins/`), connectors (`connections/`) |
| `designs/` | UI design language (`DESIGN-UI`), token/component audits, T3 designs (`t3-*`), Discord and MinIO integration designs |
| `fork/` | Fork-owned operations: `ORIGIN`, WP-0 runbook, kmv8 stack inventory, operating with Claude Code, Hermes gateway, K6 migration maps (`migration/`) |
| `engineering/` | Contributor references: `DEVELOPING`, `DATABASE`, `CLI`, `AGENT-ARTIFACTS` |
| `plans/` | Dated implementation plans and ADRs (`YYYY-MM-DD-<slug>.md`) |
| `specs/` | Dated design specs (`YYYY-MM-DD-<topic>-design.md`) |

The fork's source-of-truth trio stays at the repo root: `roadmap.md`, `backlog.md`, `design.md`.

## Rules

- New plans go in `plans/`, new design specs in `specs/`.
- Do not add a top-level `doc/` or `docs/` folder.
- Keep only design and spec material here. User guides, API reference, release runbooks, run logs,
  screenshots and one-off audit reports belong in the issue/PR that produced them.
- A doc that a test or script reads by path stays at that path; update the reader when you move it.

## Removed in the reconciliation

The last commit that still contains everything below is `ba191bc7`
(`git show ba191bc7:<old path>`).

- **Mintlify user site** (`docs/docs.json`, `start/`, `guides/`, `api/`, `cli/`, `adapters/`, upstream
  `deploy/*` pages) and the `docs:dev` script.
- **Upstream plans** under `doc/plans/` not kept here (implementation-step plans, proposed UI tweaks,
  surveys, release, docker and token plans, module system, import/export v2, CLI/API parity PRD),
  plus `docs/plans/`.
- **Upstream operations docs**: release and publishing runbooks, channels, installing, Docker
  quickstart, untrusted PR review, telemetry workflow, observability, task and MCP interface notes
  (`TASKS`, `TASKS-mcp`), ClipHub, memory landscape, OpenClaw onboarding, MCP demo script and
  release notes, `doc/connections/` guides (README, glossary, smoke lab, first-30 matrix),
  `LOCAL_PLUGIN_DEVELOPMENT`, `ideas-from-opencode`.
- **Run records**: `doc/logs/` (CLI/API parity log), `docs/qa/`, `docs/security/` audit,
  K14/K16 staging evidence, `GOAL-PROMPT` and `RUN3-PROMPT`.
- **Test-audit reports** (`docs/test-reports/`, 69 files from #171).
- **Binary assets**: PR screenshots, avatars, header/footer images. README images moved to
  `.github/assets/`.
