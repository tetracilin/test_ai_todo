const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.T3_PORT || 4173;
const DIST_DIR = path.join(__dirname, 'dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, distDir) {
  let filePath = path.join(distDir, req.url === '/' ? 'index.html' : req.url);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: serve index.html for non-file routes
      fs.readFile(path.join(distDir, 'index.html'), (err2, fallback) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fallback);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

const MAX_BODY_BYTES = 32 * 1024;
const PRIORITIES = new Set(['low', 'medium', 'high', 'urgent']);
const DISCORD_NOTIFICATION_EVENTS = [
  'issue.created',
  'issue.status_changed',
  'issue.assignee_changed',
  'issue.priority_changed',
  'issue.comment_created',
  'issue.blocked',
  'issue.unblocked',
  'issue.completed',
];
const DISCORD_NOTIFICATION_EVENT_SET = new Set(DISCORD_NOTIFICATION_EVENTS);

function defaultDiscordState() {
  return {
    users: {},
    projects: {},
    memberships: {},
    links: {},
    linkCodes: {},
    preferences: {},
    channelMappings: {},
    interactions: {},
    issues: {},
    events: {},
    deliveries: {},
  };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function now() { return new Date().toISOString(); }
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function apiError(res, status, code) { json(res, status, { code }); }
function codeHash(code) { return crypto.createHash('sha256').update(code).digest('hex'); }
function membership(state, projectId, userId) { return (state.memberships[projectId] || []).includes(userId); }
function defaultNotificationPreferences() {
  return DISCORD_NOTIFICATION_EVENTS.map((eventType) => ({ eventType, enabled: false, deliveryMode: 'dm', channelId: null }));
}
function normalizeNotificationPreferences(preferences) {
  const byEvent = new Map((Array.isArray(preferences) ? preferences : []).map((preference) => [preference.eventType, preference]));
  return defaultNotificationPreferences().map((preference) => {
    const candidate = byEvent.get(preference.eventType);
    return candidate && typeof candidate.enabled === 'boolean' && (candidate.deliveryMode === 'dm' || candidate.deliveryMode === 'channel')
      ? { ...preference, enabled: candidate.enabled, deliveryMode: candidate.deliveryMode, channelId: candidate.deliveryMode === 'channel' && typeof candidate.channelId === 'string' ? candidate.channelId : null }
      : preference;
  });
}
function notificationPreferencesFor(state, userId) {
  return normalizeNotificationPreferences(state.preferences[userId]?.preferences);
}
function discordUserIdFor(state, userId) {
  return Object.entries(state.links).find(([, linkedUserId]) => linkedUserId === userId)?.[0] || null;
}

function createDiscordStore(options) {
  const dataPath = options.discordDataPath || process.env.DISCORD_INTEGRATION_DATA_PATH || path.join(__dirname, 'data', 'discord-integration-state.json');
  let state = clone(options.discordState || defaultDiscordState());
  if (dataPath && fs.existsSync(dataPath)) state = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  for (const key of Object.keys(defaultDiscordState())) state[key] ||= {};
  function save() {
    if (!dataPath) return;
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    const temp = `${dataPath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temp, dataPath);
  }
  return { get: () => state, save };
}

function createServer(options = {}) {
  const distDir = options.distDir || DIST_DIR;
  const discord = options.discord || {};
  const store = createDiscordStore(options);
  const bridgeToken = discord.bridgeToken || process.env.DISCORD_BRIDGE_API_KEY;
  const userTokens = discord.userTokens || {};

  function principal(req) {
    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return null;
    const presented = Buffer.from(token);
    const expected = bridgeToken ? Buffer.from(bridgeToken) : null;
    if (expected && presented.length === expected.length && crypto.timingSafeEqual(presented, expected)) return { type: 'bridge' };
    const userId = userTokens[token];
    return userId ? { type: 'user', userId } : null;
  }
  function requireBridge(req, res) {
    const actor = principal(req);
    if (!actor) { apiError(res, 401, 'unauthorized'); return null; }
    if (actor.type !== 'bridge') { apiError(res, 403, 'bridge_required'); return null; }
    return actor;
  }
  function requireUser(req, res) {
    const actor = principal(req);
    if (!actor) { apiError(res, 401, 'unauthorized'); return null; }
    if (actor.type !== 'user') { apiError(res, 403, 'user_required'); return null; }
    return actor;
  }
  function readBody(req, res, done) {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { apiError(res, 413, 'payload_too_large'); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return done({});
      try { done(JSON.parse(raw)); } catch { apiError(res, 400, 'malformed_json'); }
    });
  }
  function settingsFor(state, userId) {
    const discordUserId = discordUserIdFor(state, userId);
    return {
      link: { status: discordUserId ? 'linked' : 'unlinked' },
      preferences: notificationPreferencesFor(state, userId),
      channels: Object.values(state.channelMappings)
        .filter((mapping) => membership(state, mapping.projectId, userId))
        .map((mapping) => ({ id: mapping.channelId, name: mapping.channelName || mapping.channelId, guildName: mapping.guildName })),
      channelMappings: Object.values(state.channelMappings).filter((mapping) => membership(state, mapping.projectId, userId)),
    };
  }
  function queueEvent(state, issue, eventType, origin, originDiscordChannelId) {
    const id = crypto.randomUUID();
    const event = {
      id, idempotencyKey: `${eventType}:${issue.id}`, occurredAt: now(), projectId: issue.projectId,
      issueId: issue.id, issueIdentifier: issue.identifier, eventType, origin, originDiscordChannelId,
      actor: origin === 'discord' ? 'Discord' : 'Paperclip', after: { title: issue.title, priority: issue.priority },
      issueUrl: `/issues/${issue.identifier}`,
    };
    state.events[id] = event;
    for (const mapping of Object.values(state.channelMappings)) {
      if (!mapping.notificationsEnabled || mapping.projectId !== issue.projectId) continue;
      const deliveryId = crypto.randomUUID();
      state.deliveries[deliveryId] = { id: deliveryId, eventId: id, recipient: { type: 'channel', id: mapping.channelId }, status: 'pending', attempts: 0, availableAt: now() };
    }
    const discordUserId = discordUserIdFor(state, issue.createdByUserId);
    const preference = notificationPreferencesFor(state, issue.createdByUserId).find((candidate) => candidate.eventType === eventType);
    if (discordUserId && preference?.enabled) {
      const recipient = preference.deliveryMode === 'channel'
        ? { type: 'channel', id: preference.channelId }
        : { type: 'dm', id: discordUserId };
      if (recipient.id) {
        const deliveryId = crypto.randomUUID();
        state.deliveries[deliveryId] = { id: deliveryId, eventId: id, recipient, status: 'pending', attempts: 0, availableAt: now() };
      }
    }
  }
  function createTask(state, payload) {
    const mapping = Object.values(state.channelMappings).find((candidate) =>
      candidate.channelId === payload.channelId || candidate.channelId === payload.parentChannelId);
    if (!mapping) return { error: 'channel_not_mapped', status: 403 };
    if (!mapping.taskCreationEnabled) return { error: 'task_creation_disabled', status: 403 };
    const linkedUserId = state.links[payload.discordUserId];
    if (!linkedUserId) return { error: 'not_linked', status: 403 };
    if (!membership(state, mapping.projectId, linkedUserId)) return { error: 'project_access_denied', status: 403 };
    if (state.interactions[payload.discordInteractionId]) {
      const prior = state.interactions[payload.discordInteractionId];
      if (prior.fingerprint !== JSON.stringify(payload)) return { error: 'interaction_conflict', status: 409 };
      return { issue: state.issues[prior.issueId], duplicate: true };
    }
    if (payload.assignee && !membership(state, mapping.projectId, payload.assignee)) return { error: 'assignee_invalid', status: 400 };
    const number = Object.keys(state.issues).length + 1;
    const issue = { id: crypto.randomUUID(), identifier: `T-${number}`, title: payload.title.trim(), description: payload.description?.trim() || '', priority: payload.priority || 'medium', assignee: payload.assignee || null, projectId: mapping.projectId, projectName: state.projects[mapping.projectId]?.name || mapping.projectId, createdByUserId: linkedUserId, url: `/issues/T-${number}` };
    state.issues[issue.id] = issue;
    state.interactions[payload.discordInteractionId] = { fingerprint: JSON.stringify(payload), issueId: issue.id };
    queueEvent(state, issue, 'issue.created', 'discord', payload.channelId);
    return { issue, duplicate: false };
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health') return json(res, 200, { status: 'ok', app: 'gemini-task-manager', version: '0.0.0', time: now() });
    if (!url.pathname.startsWith('/api/integrations/discord/')) {
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
      return serveStatic(req, res, distDir);
    }

    if (req.method === 'POST' && url.pathname === '/api/integrations/discord/commands/task-create') {
      if (!requireBridge(req, res)) return;
      return readBody(req, res, (body) => {
        const valid = body && body.commandName === 'paperclip task create' && typeof body.discordInteractionId === 'string' && body.discordInteractionId.length <= 128 && typeof body.discordUserId === 'string' && body.discordUserId.length <= 128 && typeof body.channelId === 'string' && body.channelId.length <= 128 && typeof body.title === 'string' && body.title.trim() && Array.from(body.title.trim()).length <= 200 && (body.description === undefined || (typeof body.description === 'string' && body.description.trim() && Array.from(body.description).length <= 8000)) && (body.priority === undefined || PRIORITIES.has(body.priority)) && (body.assignee === undefined || typeof body.assignee === 'string');
        if (!valid) return apiError(res, 400, 'validation_failed');
        const result = createTask(store.get(), body);
        if (result.error) return apiError(res, result.status, result.error);
        store.save();
        return json(res, 200, { issue: result.issue, duplicate: result.duplicate });
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/integrations/discord/settings') {
      const actor = requireUser(req, res); if (!actor) return;
      return json(res, 200, settingsFor(store.get(), actor.userId));
    }
    if (req.method === 'PATCH' && url.pathname === '/api/integrations/discord/preferences') {
      const actor = requireUser(req, res); if (!actor) return;
      return readBody(req, res, (body) => {
        if (!body || typeof body.notificationsEnabled !== 'boolean' || Object.keys(body).some((key) => key !== 'notificationsEnabled')) return apiError(res, 400, 'validation_failed');
        store.get().preferences[actor.userId] = {
          preferences: defaultNotificationPreferences().map((preference) => ({ ...preference, enabled: body.notificationsEnabled })),
        };
        store.save();
        return json(res, 200, { notificationsEnabled: body.notificationsEnabled });
      });
    }
    if (req.method === 'PUT' && url.pathname === '/api/integrations/discord/notification-preferences') {
      const actor = requireUser(req, res); if (!actor) return;
      return readBody(req, res, (body) => {
        const preferences = body?.preferences;
        const valid = Array.isArray(preferences) && preferences.length === DISCORD_NOTIFICATION_EVENTS.length &&
          new Set(preferences.map((preference) => preference?.eventType)).size === DISCORD_NOTIFICATION_EVENTS.length &&
          preferences.every((preference) => preference && DISCORD_NOTIFICATION_EVENT_SET.has(preference.eventType) && typeof preference.enabled === 'boolean' && (preference.deliveryMode === 'dm' || preference.deliveryMode === 'channel') && (preference.channelId === null || typeof preference.channelId === 'string') && (preference.deliveryMode !== 'channel' || !preference.enabled || typeof preference.channelId === 'string'));
        if (!valid) return apiError(res, 400, 'validation_failed');
        const eligibleChannels = new Set(settingsFor(store.get(), actor.userId).channels.map((channel) => channel.id));
        if (preferences.some((preference) => preference.enabled && preference.deliveryMode === 'channel' && !eligibleChannels.has(preference.channelId))) return apiError(res, 403, 'channel_access_denied');
        store.get().preferences[actor.userId] = { preferences: normalizeNotificationPreferences(preferences) };
        store.save();
        return json(res, 200, settingsFor(store.get(), actor.userId));
      });
    }
    if (req.method === 'PUT' && url.pathname === '/api/integrations/discord/settings/channel-mappings') {
      const actor = requireUser(req, res); if (!actor) return;
      return readBody(req, res, (body) => {
        const valid = body && typeof body.projectId === 'string' && typeof body.channelId === 'string' && typeof body.notificationsEnabled === 'boolean' && typeof body.taskCreationEnabled === 'boolean';
        if (!valid) return apiError(res, 400, 'validation_failed');
        if (!membership(store.get(), body.projectId, actor.userId)) return apiError(res, 403, 'project_access_denied');
        const mapping = { id: `${body.projectId}:${body.channelId}`, projectId: body.projectId, channelId: body.channelId, notificationsEnabled: body.notificationsEnabled, taskCreationEnabled: body.taskCreationEnabled };
        store.get().channelMappings[mapping.id] = mapping; store.save(); return json(res, 200, mapping);
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/integrations/discord/link-codes') {
      const actor = requireUser(req, res); if (!actor) return;
      const code = crypto.randomBytes(24).toString('base64url');
      store.get().linkCodes[codeHash(code)] = { userId: actor.userId, expiresAt: Date.now() + 10 * 60 * 1000, consumed: false };
      store.save(); return json(res, 201, { code, expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() });
    }
    if (req.method === 'POST' && url.pathname === '/api/integrations/discord/link-codes/consume') {
      if (!requireBridge(req, res)) return;
      return readBody(req, res, (body) => {
        if (!body || typeof body.code !== 'string' || typeof body.discordUserId !== 'string' || !body.discordUserId) return apiError(res, 400, 'validation_failed');
        const record = store.get().linkCodes[codeHash(body.code)];
        if (!record || record.consumed || record.expiresAt < Date.now()) return apiError(res, 400, 'link_code_invalid');
        record.consumed = true; store.get().links[body.discordUserId] = record.userId; store.save(); return json(res, 200, { linked: true });
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/integrations/discord/unlink') {
      if (!requireBridge(req, res)) return;
      return readBody(req, res, (body) => {
        if (!body || typeof body.discordUserId !== 'string' || !body.discordUserId) return apiError(res, 400, 'validation_failed');
        const linkedUserId = store.get().links[body.discordUserId];
        if (linkedUserId) {
          delete store.get().links[body.discordUserId];
          delete store.get().preferences[linkedUserId];
          store.save();
        }
        return json(res, 200, { unlinked: true });
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/integrations/discord/deliveries/pending') {
      if (!requireBridge(req, res)) return;
      const state = store.get(); const timestamp = Date.now(); const deliveries = [];
      for (const delivery of Object.values(state.deliveries)) {
        if (delivery.status !== 'pending' || new Date(delivery.availableAt).getTime() > timestamp) continue;
        delivery.status = 'leased'; delivery.leaseExpiresAt = new Date(timestamp + 60_000).toISOString();
        deliveries.push({ id: delivery.id, event: state.events[delivery.eventId], recipient: delivery.recipient });
      }
      store.save(); return json(res, 200, deliveries);
    }
    const acknowledge = url.pathname.match(/^\/api\/integrations\/discord\/events\/([^/]+)\/deliveries\/([^/]+)$/);
    if (req.method === 'POST' && acknowledge) {
      if (!requireBridge(req, res)) return;
      return readBody(req, res, (body) => {
        const eventId = decodeURIComponent(acknowledge[1]); const deliveryId = decodeURIComponent(acknowledge[2]); const delivery = store.get().deliveries[deliveryId];
        if (!delivery || delivery.eventId !== eventId) return apiError(res, 404, 'delivery_not_found');
        if (!body || !['delivered', 'suppressed', 'retryable_failure', 'terminal_failure'].includes(body.outcome)) return apiError(res, 400, 'validation_failed');
        delivery.attempts += 1;
        if (body.outcome === 'retryable_failure') { delivery.status = 'pending'; delivery.availableAt = new Date(Date.now() + Math.min(3600, Math.max(1, Number(body.retryAfterSeconds) || 30)) * 1000).toISOString(); }
        else { delivery.status = body.outcome; delivery.discordMessageId = typeof body.discordMessageId === 'string' ? body.discordMessageId : undefined; delivery.errorCode = typeof body.errorCode === 'string' ? body.errorCode : undefined; }
        store.save(); return json(res, 200, { ok: true });
      });
    }
    return apiError(res, 404, 'not_found');
  });
}

module.exports = { createServer, DIST_DIR };

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`Gemini Task Manager running on http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  });
}
