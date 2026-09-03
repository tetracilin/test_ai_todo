# TODOS

Deferred work with enough context to pick up cold. Format: what / why / context / effort / priority.

## Deferred from /autoplan CEO review of WP-0 (2026-09-01)

- [ ] **NAS bulk-import tooling for confidential-project evidence** (P3, human: ~2d / CC: ~2h)
  - What: a helper that files path references for batches of confidential (defense/B2G) artifacts already on the NAS, so confidential projects get the same evidence-gate discipline without content ever entering chat or the repo.
  - Why: C16 keeps confidential projects off chat bots entirely; their engineers use the NAS drop folder, which today means manual per-file card linking.
  - Context: provider `nas` external objects are path-reference-only (backlog.md PC-007 AC3, AD-021/C16). Revisit when the first confidential project needs volume filing.
  - Depends on: PC-007 shipped.

- [ ] **Competitive/moat section in roadmap.md** (P3, human: ~1h / CC: ~10min)
  - What: ~10 lines naming the real competitor (status quo: PM keeps doing it manually; generic AI assistants over any group chat) and the moat claim (evidence gate + Teable/NAS/dossier integration — the system, not the chat bot).
  - Why: zero competitive analysis exists in the SSoT trio; it changes what gets defended (the substrate, not the bot). Flagged by /autoplan CEO outside voice (F8), 2026-09-01.
  - Context: roadmap.md is owner-edited; /autoplan deferred rather than editing a sibling SSoT.

## From /autoplan Final Gate (2026-09-02)

- [ ] **WhatsApp work package (deferred by gate decision: Discord-only pilot)** (P2, human: ~1-2w / CC: ~2d)
  - What: bind the WhatsApp Business Cloud API transport to the channel-agnostic verb pipeline: webhook with raw-body HMAC + rate limit + body cap, media content-type allowlist, 24h-window/template handling, per-message spend cap under budgets.
  - Why: second channel, taken up only after the four verbs prove out on the Discord pilot; decision made against the post-pilot channel comparison (WhatsApp vs Zalo OA).
  - Context: all WhatsApp-specific op ACs (1/4/12) in backlog.md carry a re-scope note pointing here. Evidence to gather first: pilot-human channel usage, Zalo OA API snapshot, Meta 2026-10-01 in-window AI-reply billing.
  - Depends on: WP-0 pilot verb validation; channel comparison recorded on C13.

- [ ] **Identity doctrine sentence in roadmap.md (owner edit)** (P2, human: ~15min)
  - What: add: "For now, Tecotec-specific wins on conflict; portability is preserved only as (a) no company-id hardcoding and (b) company export keeps working."
  - Why: gate decision D4 (2026-09-02) — resolves the portable-OS premise vs Tecotec-bound backlog tension before WP-0 implementation hits it.
