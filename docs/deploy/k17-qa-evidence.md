# K17 — Independent QA, security and data acceptance: evidence report

Date: 2026-08-25 UTC. QA agent `t3-qa`, card `t_d0cf78a9`, child of K16 `t_661d88a3`.

> Historical scope: this report records only K17 staging acceptance of the 2026-08-25 artifact.
> Artifact: `paperclip:k15-7927f06fa`; API health reported commit `7927f06fa2ff091ce518e3ea29c51efa8bf971c0`.
> It does not approve `aba9eae0dea6145e09237533525ac569d40d6040` or any corrected descendant.
> This report is not a claim about current runtime state, current dependencies, or deployment approval.

## Verdict

K17 found zero P0 and zero P1 defects. One P2 remained: no timeout on initial Hermes run creation. Staging was accepted for the then-planned K18 cutover under its separate human gate.

## Evidence retained

- Staging artifact at `http://127.0.0.1:33120` was independently tested; host-network service on port 3100 was not changed.
- Blocking removed-runtime inventory passed for that historical staging artifact.
- Hermes success, auth-failure, rate-limit, upstream-error, cancel, persistence/backup/restore, scheduling, authorization, secret-redaction, accessibility, and restart checks were recorded in the original K17 QA run.
- Browser smoke rendered login labels, controls, and theme-toggle accessibility text.
- Host reboot, long-duration availability, and live SSE-drop injection were not exercised.

## Historical limits

K17 evidence identifies artifact scope only. Fresh QA on each later candidate must independently run its required typecheck, source-policy, unit, build, and supported-environment E2E gates before release or deployment.

Signed: t3-qa (K17 historical evidence).
