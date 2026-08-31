# MVP-02b: Engineer Assistant Runtime Wiring Runbook

Status: PENDING EHANDLE — the runtime is fully specified below, but execution is
blocked on the assigned engineer's real handle (`<name>`). The Slice-1 trial must
NOT start with the literal string `<name>` anywhere in the profile, agent, labels,
or Discord channel (WP-T3-PMIDE-MVP-001 §1.3/§1.4; parent card t_704f2ee9).

Owner of the decision: the PM (assign the engineer). Once a handle is chosen,
execute the steps below verbatim, replacing `<name>`.

---

## 1. Hermes profile `eng-<name>` (max_turns 150)

Source profile to clone: `t3-backend` (host: `/root/.hermes/profiles/t3-backend`).

Verify current profile list and absence of any prior eng-* profile:

```sh
hermes profile list
ls /root/.hermes/profiles/ | grep '^eng-'   # must be empty
```

Clone via Hermes CLI (preferred; keeps registry/DB in sync):

```sh
hermes profile clone t3-backend eng-<name> --max-turns 150
```

If the CLI lacks a clone subcommand on this host, fall back to manual copy +
re-register (documented here so the fallback is not improvised):

```sh
cp -a /root/.hermes/profiles/t3-backend /root/.hermes/profiles/eng-<name>
# then edit /root/.hermes/profiles/eng-<name>/config.yaml:
#   max_turns: 150   (was 600 in t3-backend)
#   (keep model block; Hermes T3 default for worker profiles is
#    deepseek/deepseek-v4-flash via nous since 2026-08-17 — do not pin a broken model)
```

POST-CLONE CHECKS (required before trial):

- `hermes profile list` shows `eng-<name>` with max_turns 150.
- `grep -c 'max_turns: 150' /root/.hermes/profiles/eng-<name>/config.yaml` == 1.
- Profile owns its own `state.db` / `auth.json` (fresh copy, no t3-backend runtime
  state carried over: sessions, cron, memories belong to the engineer).
- `gh auth status` works from that profile home (worker git credential distro was
  previously blocked by the permission classifier — re-verify, it may still be
  pending per WP §0.5).

## 2. Paperclip agent `Assistant-<name>` (adapter hermes_gateway, role engineer)

Binding mechanism (verified against this fork, 2026-08-31):

- Agents are **rows in `agents`** (drizzle schema `packages/db/src/schema/agents.ts`):
  `name`, `role`, `adapter_type='hermes_gateway'`, `adapter_config` jsonb,
  `runtime_config` jsonb, `status`.
- The hermes_gateway server adapter (`packages/adapters/hermes/src/gateway/server/execute.ts`)
  reads the system prompt from, in order:
  1. `ctx.config.instructions`
  2. `ctx.config.payloadTemplate.instructions`
  3. a generic fallback.
  It also needs `apiBaseUrl` (the running Hermes gateway API) and optional
  `paperclipApiUrl`. `k16-repoint-hermes-agents.sql` shows the exact prod/staging
  values: `apiBaseUrl=http://host.docker.internal:8642`,
  `paperclipApiUrl=http://host.docker.internal:3100/` (prod; port 33100 for prod
  compose per EXEC-LOG — verify against the live t3-prod container).
- Alternative/equivalent binding: the **managed instructions bundle**
  (`PUT /api/agents/:id/instructions-bundle/file`, `instructionsBundleMode=managed`,
  entry `AGENTS.md`). Because the delivered prompt is `agents/engineer-assistant.md`
  (YAML front matter + markdown body, following the team-catalog AGENTS.md
  convention per parent decision), the simplest correct binding is to set
  `adapterConfig.instructions` to the markdown body of that file at agent create.
- NOT a built-in agent (`docs/built-in-agents.md`: registry keyed, marker metadata
  `paperclipBuiltInAgent`, first-party system capacity) — the engineer assistant is
  operator-provisioned per engineer, so use manual agent create, not built-ins.
- NOT a teams-catalog entry unless we want it to appear in company onboarding —
  out of scope; manual create is the correct route for a single trial engineer.

### Register via API (board operator context)

```sh
COMPANY_ID="ca743e8c-e414-49c8-9134-890ea933a3f6"   # the ACTIVE "T3" company (verified live 2026-08-31)
BASE="http://127.0.0.1:33100"                        # t3-prod loopback (verified: host 33100 -> container 3100)
INSTRUCTIONS="$(cat /root/projects/t3-paperclip-Aitodo/agents/engineer-assistant.md)"

curl -sS -X POST "$BASE/api/companies/$COMPANY_ID/agents" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <BOARD-OPERATOR-KEY>" \
  -d "{
    \"name\": \"Assistant-<name>\",
    \"role\": \"engineer\",
    \"title\": \"Engineering Assistant (<name>)\",
    \"adapterType\": \"hermes_gateway\",
    \"adapterConfig\": {
      \"apiBaseUrl\": \"http://host.docker.internal:8642\",
      \"paperclipApiUrl\": \"http://host.docker.internal:3100\",
      \"instructions\": $(printf '%s' "$INSTRUCTIONS" | jq -Rs .)
    },
    \"runtimeConfig\": { \"heartbeat\": { \"enabled\": false } },
    \"budgetMonthlyCents\": 0
  }"
```

Adjust after reading the live `agents` row for the K19 acceptance agent
(`k16-trigger-hermes-run.sh` used company `73f27949`; the ACTIVE T3 company is
`ca743e8c-e414-49c8-9134-890ea933a3f6` — verify the company id the PM intends the
engineer to work in).

### POST-CREATE CHECKS

- Row present: `select id, name, role, adapter_type from agents where name='Assistant-<name>';`
- `adapter_config->>'instructions'` contains "Rule 4" and the dossier headings
  (contract intact).
- Adapter environment test via UI/API ("Test environment") passes against the
  Hermes gateway (8642 reachable, API key accepted).
- `session` strategy: keep default `issue` (per-issue resume) — matches Rule 1-4
  heartbeat behavior.

## 3. Card contract boilerplate (WP-T3-PMIDE-MVP-001 §1.4)

Every engineer card MUST be created as:

- **Title:** `[WP-xxx] <job order>` (e.g. `[WP-T3-SLICE1-001] Sửa tủ điện line 2`).
- **Labels:** `tier:open` | `tier:internal` | `tier:confidential` AND `owner:<name>`.
- **First comment** named `dossier.md`, containing the FIVE fixed headings in order
  (never renamed/reordered; empty sections fine):
  ```markdown
  ## Job order
  ## Clarifications
  ## Evidence
  ## Scope changes
  ## Related Teable rows
  ```
- **evidence_count:** the card contract's `evidence_count` field. NOTE (verified
  2026-08-31): the schema has NO persisted `evidence_count` column — MVP-01
  (approved, card t_009eb4b7) computes evidence dynamically at the done-gate from
  `issue_attachments` rows PLUS `evidence:` links under the dossier's `## Evidence`
  heading (first comment only). The prompt's Rule 2/4 reference to `evidence_count`
  is therefore the *agent-side accounting* of stored evidence; the gate itself does
  not read a column. Keep the prompt's Rule 4 threshold (`>=1 evidence to allow
  Done`) consistent with MVP-01's platform gate — currently both are `>=1`; if
  MVP-01's threshold changes, update `agents/engineer-assistant.md` Rule 4 to match.

## 4. Coordination with MVP-01 (done-gate) — verified consistent

- MVP-01 done-gate: DONE/approved at commit `7f378bfcc` (branch
  `t3-paperclip-aitodo/t_009eb4b7-*`). Refuses Done for any `tier:`-labelled card
  with zero evidence (422 `issue_done_requires_evidence` + durable
  `issue.evidence_gate_denied` activity entry). Threshold: `>=1` evidence.
- engineer-assistant.md Rule 4: refuses Done when evidence_count == 0. Same
  threshold. CONSISTENT — no prompt change needed.
- If MVP-01 later changes the threshold (e.g. `>=2`), update Rule 4 in
  `agents/engineer-assistant.md` in the same PR.

## 5. S3/MinIO evidence bucket status — PARTIALLY WIRED (flag for the trial)

- Prereq 1.1 DONE: NAS MinIO `100.124.244.21:9000` live over Tailscale; bucket
  `t3-evidence` created, versioning ON; scoped user `paperclip-evidence` (IAM
  `t3-evidence-rw`, only that bucket); creds at
  `/root/.hermes/secrets/t3-prod/paperclip_artifacts_{access,secret}_key` (600, not
  in git).
- Prereq 1.2 (MVP-04, card t_a6a3f0cc): config+s3-provider change is PREPARED
  (commit `6dd869ad0` on branch `t3-paperclip-aitodo/t_a6a3f0cc-*`) but NOT merged,
  NOT deployed — the paperclip prod service is still on `local_disk` storage and
  gated behind the QA-fix merge (t_cf607d9f). Therefore the runtime evidence
  backend is NOT yet live.
- Consequence: at trial start the prompt's Rule 2 will log `PENDING STORAGE` for
  evidence files (graceful degradation, no fabricated links) UNTIL MVP-04 deploys.
  The PM must treat evidence attachment as unverified until MVP-04 lands.

## 6. Gates

- No push to main, no deploy, no force-push, no .env — until the human gate.
- This branch (`t3-paperclip-aitodo/t_b1f79545-*`) carries only the delivered
  prompt + this runbook; execution of §1-§2 is LEFT QUEUED pending the real handle.

## 7. What execution of this runbook requires from the PM

1. Real engineer handle `<name>` (who is the Slice-1 engineer; verify against the
   Teable Assignees map if applicable — do not reuse a placeholder).
2. Confirm the company id the engineer works in (default candidates: active T3 =
   `ca743e8c-...`; k16 staging used `73f27949`).
3. Confirm whether evidence storage should be treated as live only after MVP-04
   merge (recommended: yes).