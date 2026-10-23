# Upstream imports manifest

Every file taken from upstream `paperclipai/paperclip` under the feature-driven import rule in `CLAUDE.md` gets one
row here, added by the PR that imports it. The next import starts from this list instead of re-deriving it.
Licence and provenance rules: `technical-spec/fork/ORIGIN.md`. Started by
`technical-spec/specs/2026-10-23-upstream-adapters-ai-connections-design.md` (D15, section 4.8).

"Upstream tests" is `unmodified`, or `edited: <reason>`. "Fork diff lines" is the fork's diff against the upstream
file at the last re-diff; above 300 the fork stops following the file and sets "Still followed" to `no`. For a
migration, put the upstream migration ids it replaces in "Upstream path".

| Upstream sha | Upstream path | Fork path | Fork PR | Date | Upstream tests | Fork diff lines | Still followed |
|---|---|---|---|---|---|---|---|
