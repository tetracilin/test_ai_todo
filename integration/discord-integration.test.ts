import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

const { createServer } = require('../server.cjs');

const bridgeAuth = { Authorization: 'Bearer bridge-test-token' };
const userAuth = { Authorization: 'Bearer user-1-token' };
const seededState = {
  users: { 'user-1': { id: 'user-1' } },
  projects: { 'project-1': { id: 'project-1', name: 'Core' } },
  memberships: { 'project-1': ['user-1'] },
  links: {}, linkCodes: {}, preferences: {},
  channelMappings: {
    'project-1:channel-1': {
      id: 'project-1:channel-1', projectId: 'project-1', channelId: 'channel-1',
      notificationsEnabled: true, taskCreationEnabled: true,
    },
  },
  interactions: {}, issues: {}, events: {}, deliveries: {},
};

function taskPayload(overrides: Record<string, unknown> = {}) {
  return {
    discordInteractionId: 'interaction-1', discordUserId: 'discord-user-1', guildId: 'guild-1',
    channelId: 'channel-1', parentChannelId: null, commandName: 'paperclip task create',
    title: 'Create task from Discord', priority: 'high', ...overrides,
  };
}

describe('Discord integration HTTP contracts', () => {
  let server: Server;
  let statePath: string;

  beforeAll(async () => {
    statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'discord-state-')), 'state.json');
    server = createServer({
      discord: { bridgeToken: 'bridge-test-token', userTokens: { 'user-1-token': 'user-1' } },
      discordState: seededState,
      discordDataPath: statePath,
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
  });

  afterAll(() => {
    server.close();
    fs.rmSync(path.dirname(statePath), { recursive: true, force: true });
  });

  it('rejects missing and wrong-scope credentials without leaking secrets', async () => {
    const unauthenticated = await request(server).post('/api/integrations/discord/commands/task-create').send(taskPayload());
    expect(unauthenticated.status).toBe(401);
    const userScoped = await request(server).post('/api/integrations/discord/commands/task-create').set(userAuth).send(taskPayload());
    expect(userScoped.status).toBe(403);
    expect(JSON.stringify(userScoped.body)).not.toContain('token');
  });

  it('issues a one-time code, consumes it through bridge auth, and does not persist raw code', async () => {
    const issued = await request(server).post('/api/integrations/discord/link-codes').set(userAuth).send({});
    expect(issued.status).toBe(201);
    expect(issued.body.code).toEqual(expect.any(String));
    const rawCode = issued.body.code;

    const consumed = await request(server)
      .post('/api/integrations/discord/link-codes/consume').set(bridgeAuth)
      .send({ code: rawCode, discordUserId: 'discord-user-1' });
    expect(consumed.status).toBe(200);
    const repeated = await request(server)
      .post('/api/integrations/discord/link-codes/consume').set(bridgeAuth)
      .send({ code: rawCode, discordUserId: 'discord-user-1' });
    expect(repeated.status).toBe(400);
    expect(fs.readFileSync(statePath, 'utf8')).not.toContain(rawCode);
  });

  it('creates task once for duplicate interaction and rejects malformed payloads', async () => {
    const first = await request(server).post('/api/integrations/discord/commands/task-create').set(bridgeAuth).send(taskPayload());
    expect(first.status).toBe(200);
    expect(first.body.duplicate).toBe(false);
    expect(first.body.issue.createdByUserId).toBe('user-1');
    const duplicate = await request(server).post('/api/integrations/discord/commands/task-create').set(bridgeAuth).send(taskPayload());
    expect(duplicate.status).toBe(200);
    expect(duplicate.body).toMatchObject({ duplicate: true, issue: { id: first.body.issue.id } });
    const malformed = await request(server).post('/api/integrations/discord/commands/task-create').set(bridgeAuth).send(taskPayload({ title: ' ' }));
    expect(malformed.status).toBe(400);
    expect(malformed.body).toEqual({ code: 'validation_failed' });
  });

  it('enforces user-owned settings and notification opt-out', async () => {
    const denied = await request(server).put('/api/integrations/discord/settings/channel-mappings').set(userAuth).send({
      projectId: 'other-project', channelId: 'channel-2', notificationsEnabled: true, taskCreationEnabled: true,
    });
    expect(denied.status).toBe(403);

    const issued = await request(server).post('/api/integrations/discord/link-codes').set(userAuth).send({});
    const linked = await request(server).post('/api/integrations/discord/link-codes/consume').set(bridgeAuth).send({
      code: issued.body.code, discordUserId: 'discord-user-1',
    });
    expect(linked.status).toBe(200);
    const settingsBeforeLink = await request(server).get('/api/integrations/discord/settings').set(userAuth);
    expect(settingsBeforeLink.body).toMatchObject({ link: { status: 'linked' } });
    expect(settingsBeforeLink.body.preferences).toHaveLength(8);
    expect(settingsBeforeLink.body.preferences.every((preference: { enabled: boolean }) => !preference.enabled)).toBe(true);

    const optOut = await request(server).put('/api/integrations/discord/notification-preferences').set(userAuth).send({
      preferences: settingsBeforeLink.body.preferences.map((preference: Record<string, unknown>) => ({ ...preference, enabled: false })),
    });
    expect(optOut.status).toBe(200);
    expect(optOut.body.preferences.every((preference: { enabled: boolean }) => !preference.enabled)).toBe(true);
    expect(optOut.body.channelMappings).toHaveLength(1);

    const forbiddenChannel = await request(server).put('/api/integrations/discord/notification-preferences').set(userAuth).send({
      preferences: settingsBeforeLink.body.preferences.map((preference: Record<string, unknown>) => preference.eventType === 'issue.created'
        ? { ...preference, enabled: true, deliveryMode: 'channel', channelId: 'other-channel' }
        : preference),
    });
    expect(forbiddenChannel.status).toBe(403);

    const unlinked = await request(server).post('/api/integrations/discord/unlink').set(bridgeAuth).send({ discordUserId: 'discord-user-1' });
    expect(unlinked.status).toBe(200);
    const afterUnlink = await request(server).get('/api/integrations/discord/settings').set(userAuth);
    expect(afterUnlink.body.link.status).toBe('unlinked');
    expect(afterUnlink.body.preferences.every((preference: { enabled: boolean }) => !preference.enabled)).toBe(true);
  });

  it('leases durable outbox delivery, retries 429, then marks 403/404 terminal', async () => {
    const pending = await request(server).get('/api/integrations/discord/deliveries/pending').set(bridgeAuth);
    expect(pending.status).toBe(200);
    expect(pending.body).toHaveLength(1);
    const delivery = pending.body[0];
    const retry = await request(server)
      .post(`/api/integrations/discord/events/${delivery.event.id}/deliveries/${delivery.id}`).set(bridgeAuth)
      .send({ outcome: 'retryable_failure', errorCode: 'discord_http_429', retryAfterSeconds: 1 });
    expect(retry.status).toBe(200);
    const terminal = await request(server)
      .post(`/api/integrations/discord/events/${delivery.event.id}/deliveries/${delivery.id}`).set(bridgeAuth)
      .send({ outcome: 'terminal_failure', errorCode: 'discord_http_403' });
    expect(terminal.status).toBe(200);
    const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    expect(persisted.deliveries[delivery.id]).toMatchObject({ status: 'terminal_failure', errorCode: 'discord_http_403', attempts: 2 });
  });
});
