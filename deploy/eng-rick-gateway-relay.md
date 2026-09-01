# eng-rick gateway relay

`hermes-eng-rick-gateway-relay.service` is the production-only TCP relay for Paperclip's `t3-prod_gateway` bridge.

It binds only `172.16.10.1:8643` on `br-67f2e613a24c` and forwards to eng-rick's loopback-only Hermes API listener at `127.0.0.1:8643`. It does not expose port 8643 on a LAN or public interface.

## Install

Run as host root after deploying this directory:

```sh
install -D -m 0644 deploy/systemd/hermes-eng-rick-gateway-relay.service /etc/systemd/system/hermes-eng-rick-gateway-relay.service
systemctl daemon-reload
systemctl enable --now hermes-eng-rick-gateway-relay.service
ufw allow in on br-67f2e613a24c from 172.16.10.0/24 to 172.16.10.1 port 8643 proto tcp comment 'eng-rick Hermes gateway prod bridge only'
```

UFW persists this rule in `/etc/ufw/user.rules`; enabled systemd persists the relay across reboot.

## Paperclip adapter

Set `adapterConfig.apiBaseUrl` to exactly `http://172.16.10.1:8643`.

This is private plain HTTP inside the Docker bridge. Set `adapterConfig.dangerouslyAllowInsecureRemoteHttp` to `true`. Paperclip's Hermes adapter rejects every non-loopback `http:` API URL without this exact flag. Authentication remains mandatory: Hermes accepts only `Authorization: Bearer <API_SERVER_KEY>`.

Do not replace `host.docker.internal` globally. It resolves to docker0 (`172.16.0.1`) for this container, which is not reachable from `t3-prod_gateway`.

## Verify

```sh
chmod 0755 deploy/scripts/verify-eng-rick-gateway-relay.sh
deploy/scripts/verify-eng-rick-gateway-relay.sh
```

Expected evidence: relay enabled and active; listener bound to `172.16.10.1:8643`; one scoped UFW chain rule; authenticated `GET /v1/health` returns 200; authenticated `GET /v1/models` returns 200 and unauthenticated `/v1/models` returns 401.

`GET /v1/health` is intentionally public in current Hermes gateway code, so it proves TCP reachability only. Use `/v1/models` for authentication evidence; it invokes the gateway's Bearer `API_SERVER_KEY` guard.

## Rollback

```sh
systemctl disable --now hermes-eng-rick-gateway-relay.service
ufw delete allow in on br-67f2e613a24c from 172.16.10.0/24 to 172.16.10.1 port 8643 proto tcp
rm -f /etc/systemd/system/hermes-eng-rick-gateway-relay.service
systemctl daemon-reload
```
