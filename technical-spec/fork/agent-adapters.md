---
title: Agent Adapters
summary: Which adapters can create agents, what each needs on the host, and how to connect a Hermes Gateway securely
---

## Which adapters an operator can pick

`GET /api/adapters` returns every registered adapter. Each entry has a `selectable` flag. The onboarding
wizard, the New Agent dialog and the New Agent page show only adapters where `selectable` is true.
The server rejects any other adapter with `422 Adapter "<type>" is not available on this instance`.

`selectable` comes from `PAPERCLIP_SELECTABLE_ADAPTER_TYPES`. The default is `hermes_gateway,claude_local,hermes_local`.
The deploy files (`deploy/compose.yaml`, `t3-nightly.yml`, `t3-release.yml`) use the same default.

| Adapter | Needs on the host | Sign-in |
|---|---|---|
| `claude_local` | `claude` CLI (`@anthropic-ai/claude-code`) on `PATH` | One-time interactive browser login per agent or stored session |
| `codex_local` | `codex` CLI (`@openai/codex`) on `PATH` | One-time device-code login |
| `hermes_local` | `hermes` CLI (`pip install hermes-agent`, Python 3.11 or newer) on `PATH` | A model provider key, in the Hermes home `.env` or in the agent's env |
| `hermes_gateway` | A reachable Hermes API server | `apiBaseUrl` and a secret-backed `apiKey` |

The production Docker image already installs the Claude Code, Codex, OpenCode and Kimi CLIs (see the
`Dockerfile`). Installing a CLI does not sign it in. Each agent still needs the login step once.

`hermes_gateway` is hidden from the card pickers. It needs an `apiBaseUrl` and an `apiKey` that the pickers
do not collect. Create it from the agent configuration form or the API.

## Run Hermes on the Paperclip host (`hermes_local`)

`hermes_local` starts the `hermes` CLI as a child process on the machine that runs Paperclip, the same
way `claude_local` starts `claude`. Use it when Paperclip and Hermes share a trusted host.

Hermes keeps its config, provider keys, skills and sessions in one directory (`HERMES_HOME`).
Paperclip finds it in this order:

1. `adapterConfig.env.HERMES_HOME`
2. `adapterConfig.env.HOME`, then `.hermes` inside it
3. the `HERMES_HOME` variable of the Paperclip server
4. `~/.hermes` of the user that runs Paperclip

Model detection, the environment check and the skills list all read the same directory that the
CLI uses. Give each environment its own directory. Do not point it at the home of another Hermes
process, for example a running gateway. Two programs would then write the same `state.db`, and the
gateway home holds its messaging tokens.

Check it: create the agent, press **Test now**, and read the `hermes --version`, Python and API-key checks.

## Connect to a Hermes Gateway securely

The Hermes API server runs agent work with the terminal tool. Its `API_SERVER_KEY` is therefore equal to
remote code execution as the gateway user. Treat it like an SSH key.

1. **Keep the API on loopback.** Hermes binds `127.0.0.1:8642` by default and refuses to start without a
   key of 16 or more characters. Do not bind it to `0.0.0.0`. Do not add TCP forwarders.
2. **Publish it on the tailnet with HTTPS.** Paperclip rejects plain `http://` to any non-loopback host.
   Run on the gateway host:

   ```sh
   tailscale serve --bg --https=8443 http://127.0.0.1:8642
   ```

   Use `https://<gateway-host>.<tailnet>.ts.net:8443` as `apiBaseUrl`. Never use `tailscale funnel`.
   Limit access with a tailnet ACL that allows only the Paperclip hosts.
3. **Use one key per environment.** Generate each with `openssl rand -hex 32`. Store it as a Paperclip
   secret and reference it from `apiKey`. Do not put it in compose files or the repository. Rotate it on a schedule.
4. **Reduce the blast radius.** Set `terminal.backend: docker` in the Hermes config. Run the gateway as a
   non-root user. Use one Hermes profile per environment, because Hermes treats all callers as equally trusted.
5. **Keep the dashboard on loopback.** Start `hermes dashboard` without `--host 0.0.0.0` and reach it with
   `tailscale serve` or an SSH tunnel. A non-loopback bind needs an auth provider, and it widens the attack surface.
6. **Containers on the same host.** A container cannot reach a loopback-only listener through
   `host.docker.internal`. Point `HERMES_API_BASE_URL` at the tailnet HTTPS URL. Do not use the
   `hermes_gateway` insecure-HTTP escape hatch with real credentials.

### Verify

```sh
# On the gateway host: the API answers on loopback only.
ss -ltn | grep 8642            # expect 127.0.0.1:8642
curl -s http://127.0.0.1:8642/health

# From a Paperclip host: the HTTPS URL answers with a valid certificate.
curl -s -H "Authorization: Bearer $API_SERVER_KEY" https://<gateway-host>.<tailnet>.ts.net:8443/health

# From outside the tailnet: nothing answers.
curl -m 8 http://<public-ip>:8642/health   # expect a timeout
```

In Paperclip, open the agent and choose **Test now**. The `hermes_gateway` environment check must pass.
