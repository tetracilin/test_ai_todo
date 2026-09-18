import type { Db } from "@paperclipai/db";
import { HttpError, unprocessable } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { secretService } from "./secrets.js";
import {
  createTeableClient,
  type TeableClient,
  type TeableError,
  type TeableRecord,
  type TeableSecretsDeps,
} from "./teable-client.js";
import type { NewObjectTarget } from "./issue-evidence-links.js";

/**
 * Teable append-only agent write (F-010-2, story PC-010, Slice-1 subset per gate decision T2).
 *
 * Scope, exactly the gate-T2 subset -- NOT the full PC-010 story:
 *   - AC1: an explicit allowlist of ONE Teable table; a write outside it is refused with an
 *     actionable message, before any network call.
 *   - AC4: the created row is handed back as a `NewObjectTarget` for the caller to link on the
 *     card (`issueEvidenceLinkService(db).link(...)`) and append one dossier Evidence-log line.
 *     This module does neither itself -- see "Division of labour" below.
 *   - AC6: a bot-account attribution marker, so F-005-1's future conflict flagging never fires
 *     on this bot's own writes. `isPaperclipBotAuthored` is exported so F-005-1 consumes the
 *     rule rather than re-deriving it.
 * Deferred to Slice 2 (PC-010 AC2/AC3, out of scope here): multi-table allowlist framework,
 * per-table schema maps, update-with-conflict policy.
 *
 * Division of labour, matching the existing `evidence-provider-git.ts` / `evidence-provider-nas.ts`
 * shape: this module resolves the allowlist, talks to Teable, and returns a target -- it does NOT
 * call `issueEvidenceLinkService` or `issueDossierService` itself. The caller (the HTTP route)
 * owns the link + dossier-append + activity-log sequence, exactly as
 * `POST /issues/:id/evidence-links` already does for the other three providers.
 *
 * Never contacts a live Teable instance in this repo's own tests -- see `teable-client.ts`'s
 * header comment for why. This module reuses that client rather than issuing any HTTP itself.
 */

/** Per-company secret naming the ONE table this bot may create rows in (AC1). */
export const TEABLE_WRITE_TABLE_SECRET_NAME = "TEABLE_WRITE_TABLE_ID";

/**
 * Per-company secret naming the Teable user account the write token belongs to (AC6). Compared
 * against `TeableRecord.createdBy` -- documented by `teable-client.ts` as "a user NAME, not an
 * id" -- after every create. INFERRED: that self-hosted Teable populates `createdBy` from the
 * authenticated token on a create is taken from the published docs, not observed against a live
 * instance; the staging re-verification pass (see `teable-client.ts`'s own fixture caveat) is
 * the regression gate on this assumption too.
 *
 * Rejected alternative: a marker *column* written into the row payload. That assumes a schema
 * the allowlisted table may not have, and per-table schema maps are exactly what gate T2
 * deferred to Slice 2 -- the account-level marker needs no schema knowledge at all.
 */
export const TEABLE_BOT_ACCOUNT_SECRET_NAME = "TEABLE_BOT_ACCOUNT_NAME";

/**
 * F-005-1 consumes this predicate so the "skip the bot's own writes" rule is written once. A
 * `null` `botAccountName` (no `TEABLE_BOT_ACCOUNT_NAME` secret configured yet) never matches --
 * an unconfigured instance must not silently treat every row as bot-authored.
 */
export function isPaperclipBotAuthored(
  record: Pick<TeableRecord, "createdBy" | "lastModifiedBy">,
  botAccountName: string | null,
): boolean {
  if (!botAccountName) return false;
  return record.createdBy === botAccountName || record.lastModifiedBy === botAccountName;
}

/** Browser-facing Teable origin, separate from the server-to-server `PAPERCLIP_TEABLE_BASE_URL`
 * (`http://teable:3000`), which is meaningless off the app host. Optional -- a stock deployment
 * with none configured gets `url: null` evidence rows rather than a link that 404s. */
function resolvePublicBaseUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = env.PAPERCLIP_TEABLE_PUBLIC_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/**
 * Maps a `TeableResult<T>`'s `ok: false` error into the HTTP shape this route's callers expect.
 * `error.message` is already safe to show a user (`teable-client.ts` guarantees it never carries
 * a token or row data), so it is forwarded verbatim. `details.retryAfterSeconds` lets the route
 * set a `Retry-After` header on the 503 without this module touching `Response` directly.
 */
function httpErrorForTeableError(error: TeableError): HttpError {
  if (error.code === "teable_not_configured") {
    return unprocessable(error.message);
  }
  if (error.code === "teable_rate_limited") {
    return new HttpError(503, error.message, { retryAfterSeconds: error.retryAfterSeconds ?? null });
  }
  // teable_auth_required / teable_forbidden / teable_not_found / teable_invalid_request /
  // teable_server_error / teable_unreachable / teable_invalid_response: all upstream failures
  // this caller cannot fix by retrying differently -- surfaced as a 502.
  return new HttpError(502, error.message);
}

export type TeableAppendResult = {
  record: TeableRecord;
  target: NewObjectTarget;
};

export function teableAppendService(
  db: Db,
  opts: {
    client?: TeableClient;
    secrets?: TeableSecretsDeps;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const client = opts.client ?? createTeableClient(db, { env: opts.env });
  const secrets: TeableSecretsDeps = opts.secrets ?? (secretService(db) as unknown as TeableSecretsDeps);
  const env = opts.env ?? process.env;

  async function resolveCompanySecret(companyId: string, name: string): Promise<string | null> {
    const secret = await Promise.resolve(secrets.getByName(companyId, name)).catch(() => null);
    if (!secret) return null;
    // Same audit-trail shape teable-client.ts uses for its own token resolution, distinguished
    // by consumerId so a secret_access_events row is traceable to this module.
    const value = await Promise.resolve(
      secrets.resolveSecretValue(companyId, secret.id, "latest", {
        accessContext: { consumerType: "system", consumerId: "teable-append", actorType: "system" },
      }),
    )
      .then((v) => v.trim())
      .catch(() => "");
    return value || null;
  }

  return {
    /**
     * Creates one row in the ONE allowlisted table, then returns the `NewObjectTarget` the
     * caller links on the card. Refuses the whole write -- no row, no target -- when the table
     * is not allowlisted; never retries a failed create (Teable's create takes no idempotency
     * key, so a retry would duplicate a row).
     */
    appendRow: async (input: {
      companyId: string;
      tableId: string;
      fields: Record<string, unknown>;
    }): Promise<TeableAppendResult> => {
      const allowlistedTableId = await resolveCompanySecret(input.companyId, TEABLE_WRITE_TABLE_SECRET_NAME);
      if (!allowlistedTableId) {
        throw unprocessable(
          `No agent-writable Teable table is configured for this company. Set the company secret ${TEABLE_WRITE_TABLE_SECRET_NAME} to the id of the one allowlisted table.`,
        );
      }
      if (input.tableId !== allowlistedTableId) {
        throw unprocessable(
          `Teable table ${input.tableId} is not agent-writable. Slice 1 allows exactly one table: ${allowlistedTableId}.`,
        );
      }

      const result = await client.createRecords({
        companyId: input.companyId,
        tableId: input.tableId,
        records: [{ fields: input.fields }],
      });
      if (!result.ok) throw httpErrorForTeableError(result.error);
      const record = result.data[0];
      if (!record) throw new HttpError(502, "Teable reported success but returned no created record.");

      const botAccountName = await resolveCompanySecret(input.companyId, TEABLE_BOT_ACCOUNT_SECRET_NAME);
      if (!isPaperclipBotAuthored(record, botAccountName)) {
        // The write still stands: the row already exists remotely, and failing here would
        // strand it as an unlinked orphan for a reason the operator can fix after the fact.
        // This warning is that operator's signal that the write token is not the bot account
        // configured for TEABLE_BOT_ACCOUNT_NAME, and F-005-1 will mis-flag this row.
        logger.warn(
          { companyId: input.companyId, tableId: input.tableId, recordId: record.id, createdBy: record.createdBy, expectedBotAccountName: botAccountName },
          "Teable row was not created by the configured bot account; F-005-1's conflict flagging may fire on it",
        );
      }

      const publicBaseUrl = resolvePublicBaseUrl(env);
      const externalId = `${input.tableId}/${record.id}`;
      const target: NewObjectTarget = {
        providerKey: "teable",
        objectType: "record",
        externalId,
        displayTitle: record.name ?? externalId,
        url: publicBaseUrl ? `${publicBaseUrl}/table/${input.tableId}/${record.id}` : null,
        data: {
          tableId: input.tableId,
          recordId: record.id,
          createdBy: record.createdBy,
          createdTime: record.createdTime,
        },
      };

      return { record, target };
    },
  };
}
