# Gemini Notebook (NotebookLM) MCP — Auth Onboarding

This covers the manually-installed `notebooklm-mcp-cli` (`nlm`) on the host —
`uv tool install`'d under `/root`, not yet wired into Paperclip's own MCP
runtime governance (see `doc/MCP-RUNTIME-OPERATIONS.md` for that layer). Use
this doc to add another person's Google account as an `nlm` auth profile.

## Background: why this isn't a one-line `nlm login`

`nlm login` launches a real Chromium and drives the actual Google OAuth
consent screen so it can extract session cookies. Two things get in the way
on this host:

1. **Root + sandbox.** Chromium refuses `Running as root without
   --no-sandbox is not supported`, and `notebooklm_tools/utils/cdp.py`
   (upstream, as of `nlm` 0.9.14) never passes `--no-sandbox`.
   **Fixed permanently**: `/usr/local/bin/chromium` is a wrapper script
   ahead of `/snap/bin` in `$PATH` that adds `--no-sandbox
   --disable-dev-shm-usage`. The CLI finds it transparently via
   `shutil.which("chromium")`. Nothing to redo here — `vnc-login.sh`
   recreates it idempotently anyway.
2. **No real display.** This is a headless host, but Google's OAuth flow
   (password, 2FA) needs a human to actually click through it — it can't be
   scripted or done on someone's behalf. The fix is a temporary,
   password-protected VNC session scoped to the Tailscale network so the
   human can see and drive the real browser window.

## Adding a second Google account (e.g. a colleague)

Each `nlm` profile is an isolated Chrome session tied to one Google account,
so your colleague gets her own profile rather than overwriting yours.

1. On the host, as root:
   ```bash
   /root/ops/notebooklm/vnc-login.sh her-profile-name
   ```
   (pick any short slug, e.g. `jane` — avoid `default`, that's already
   `tetracilin@gmail.com`)

2. The script prints a URL and a one-time VNC password, e.g.:
   ```
   http://100.103.41.112:6080/vnc.html
   VNC password: <random>
   ```
   Send **both** to your colleague over a trusted channel (she needs to be
   on the same Tailscale network to reach that URL).

3. She opens the URL in any browser, connects with the password, and sees a
   Chromium window already on the Google sign-in page. She logs in there
   with her own Google account (password, 2FA) — same as any normal Google
   login. **Nobody but her enters her credentials.**

4. She has ~5 minutes (`nlm`'s built-in login timeout). If it times out
   before she connects, just rerun step 1 — no need to redo any setup, it's
   idempotent. A `Chrome is already running` error on rerun just means a
   previous attempt's Chromium didn't exit cleanly; the script kills stale
   instances before relaunching.

5. Once you see `✓ Successfully authenticated!` in the operator terminal (or
   confirm via step below), tear down the VNC bridge — it should not be
   left running:
   ```bash
   /root/ops/notebooklm/vnc-teardown.sh
   ```

## Verifying a login

```bash
NOTEBOOKLM_MCP_CLI_PATH=/root/paperclip-data/notebooklm nlm login --check --profile her-profile-name
NOTEBOOKLM_MCP_CLI_PATH=/root/paperclip-data/notebooklm nlm login profile list
```

Expect `✓ Authentication valid!` with her email and a notebook count.

## Switching / using a non-default profile

```bash
nlm login switch her-profile-name   # makes it the default for subsequent commands
nlm notebook list --profile her-profile-name   # or pass --profile explicitly per-call
```

## Security notes

- `vnc-login.sh` binds x11vnc to `127.0.0.1` only (IPv6 explicitly disabled —
  this host has a routable global IPv6 address, so an unqualified listener
  would otherwise be reachable from the public internet) and binds the
  noVNC websocket bridge only to the Tailscale interface address, never
  `0.0.0.0`. It is not reachable outside the tailnet.
- The VNC password is freshly random per run and shredded by
  `vnc-teardown.sh`.
- Nobody (human operator or agent) should ever type a colleague's Google
  credentials on her behalf — always have her connect and type them herself.
- Always run `vnc-teardown.sh` after use. Don't leave the bridge up.
