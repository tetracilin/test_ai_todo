import type { Db } from "@paperclipai/db";
import { unprocessable } from "../errors.js";
import { secretService } from "./secrets.js";
import { httpErrorForTeableError, TEABLE_WRITE_TABLE_SECRET_NAME } from "./teable-append.js";
import {
  createTeableClient,
  type TeableClient,
  type TeableRecordPage,
  type TeableSecretsDeps,
} from "./teable-client.js";

/**
 * Teable read-only agent query (F-010-3, story PC-010 AC5, Slice-1 subset per gate decision T2).
 *
 * Scope: "reads let the agent answer 'what's in table X for Y' in chat without granting write
 * scope" (AC5, verbatim). This module NEVER calls `TeableClient.createRecords` and grants no
 * write capability of any kind -- see "Never a write path" below.
 *
 * Allowlist: Slice 1 ships exactly ONE agent-facing Teable table total (gate decision T2), so
 * this module deliberately reuses `TEABLE_WRITE_TABLE_SECRET_NAME` -- the SAME company secret
 * `teable-append.ts` (F-010-2) already enforces -- rather than introducing a second,
 * independently-configurable read allowlist that could silently diverge from the write one. A
 * table the bot may not write to, it may also not read; Slice 2's AC1 multi-table allowlist
 * framework is where read and write scopes are expected to separate.
 *
 * Never a write path: unlike `teable-append.ts`, a successful query here creates no
 * `external_objects` row, no `issue_evidence_links` row, and no dossier line -- there is nothing
 * to link, because nothing was created or changed. The caller (the HTTP route) renders the
 * returned page directly into the chat reply.
 *
 * Never contacts a live Teable instance in this repo's own tests -- see `teable-client.ts`'s
 * header comment for why. This module reuses that client rather than issuing any HTTP itself.
 */

export type TeableReadService = ReturnType<typeof teableReadService>;

export function teableReadService(
  db: Db,
  opts: {
    client?: TeableClient;
    secrets?: TeableSecretsDeps;
    env?: NodeJS.ProcessEnv;
  } = {},
) {
  const client = opts.client ?? createTeableClient(db, { env: opts.env });
  const secrets: TeableSecretsDeps = opts.secrets ?? (secretService(db) as unknown as TeableSecretsDeps);

  async function resolveCompanySecret(companyId: string, name: string): Promise<string | null> {
    const secret = await Promise.resolve(secrets.getByName(companyId, name)).catch(() => null);
    if (!secret) return null;
    // Same audit-trail shape teable-append.ts uses for its own secret resolution, distinguished
    // by consumerId so a secret_access_events row is traceable to this module.
    const value = await Promise.resolve(
      secrets.resolveSecretValue(companyId, secret.id, "latest", {
        accessContext: { consumerType: "system", consumerId: "teable-read", actorType: "system" },
      }),
    )
      .then((v) => v.trim())
      .catch(() => "");
    return value || null;
  }

  return {
    /**
     * Lists (optionally search-filtered) rows from the ONE allowlisted table. Refuses before any
     * network call when the requested table is not the allowlisted one, matching
     * `teableAppendService.appendRow`'s allowlist-first shape exactly.
     */
    queryRows: async (input: {
      companyId: string;
      tableId: string;
      search?: string;
      take?: number;
      skip?: number;
    }): Promise<TeableRecordPage> => {
      const allowlistedTableId = await resolveCompanySecret(input.companyId, TEABLE_WRITE_TABLE_SECRET_NAME);
      if (!allowlistedTableId) {
        throw unprocessable(
          `No agent-readable Teable table is configured for this company. Set the company secret ${TEABLE_WRITE_TABLE_SECRET_NAME} to the id of the one allowlisted table.`,
        );
      }
      if (input.tableId !== allowlistedTableId) {
        throw unprocessable(
          `Teable table ${input.tableId} is not agent-readable. Slice 1 allows exactly one table: ${allowlistedTableId}.`,
        );
      }

      const result = await client.listRecords({
        companyId: input.companyId,
        tableId: input.tableId,
        search: input.search,
        take: input.take,
        skip: input.skip,
      });
      if (!result.ok) throw httpErrorForTeableError(result.error);
      return result.data;
    },
  };
}
