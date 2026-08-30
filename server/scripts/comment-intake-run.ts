// One-shot tagged-comment (@dev) ingestion runner.
//
// Use cases:
//   - Manual run:        `pnpm comment-intake:run`
//   - Ops smoke check:   `pnpm comment-intake:smoke` (connectivity + schema)
//   - External cron:     run the built artifact with the server's env and rely
//                        on the nonzero exit status for failure alerting.
//
// The in-process heartbeat scheduler is the primary execution path; this
// script exists so operators can trigger a poll on demand and so a deployment
// that prefers a cron container / systemd timer / CI schedule can run the same
// code with the same env-driven configuration.
//
// Output is machine-readable JSON on stdout (one line per phase). Errors go to
// stderr. No secret values (DATABASE_URL, POSTGRES_PASSWORD, tokens) are ever
// written to either stream.
//
// Exit codes: 0 = success (including all-skipped), 1 = a source failed, the
// smoke check failed, or an unexpected error occurred, 2 = configuration error
// (e.g. server uses embedded Postgres, which only the in-process scheduler can
// poll).
import { commentIntakeSources, createDb } from "@paperclipai/db";
import { loadConfig } from "../src/config.js";
import { commentIntakeService } from "../src/services/comment-intake.js";

const SMOKE = process.argv.includes("--smoke");

function emit(phase: string, payload: unknown) {
  process.stdout.write(`${JSON.stringify({ phase, ...payload })}\n`);
}

async function main(): Promise<number> {
  const config = loadConfig();

  if (config.databaseMode !== "postgres" || !config.databaseUrl) {
    process.stderr.write(
      "comment-intake-run requires a Postgres database (DATABASE_URL or database.connectionString); "
      + "embedded-postgres instances are polled by the in-process heartbeat scheduler.\n",
    );
    return 2;
  }

  const db = createDb(config.databaseUrl);
  const service = commentIntakeService(db, config.commentIntake);

  try {
    if (SMOKE) {
      const sources = await db.select().from(commentIntakeSources);
      const enabled = sources.filter((source) => source.enabled).length;
      emit("smoke", {
        ok: true,
        table: "comment_intake_sources",
        sources: sources.length,
        enabled,
        // The scheduler knobs in effect, all non-secret.
        config: {
          enabled: config.commentIntake.enabled,
          pollIntervalMs: config.commentIntake.pollIntervalMs,
          batchSize: config.commentIntake.batchSize,
          runTimeoutMs: config.commentIntake.runTimeoutMs,
          maxConsecutiveFailures: config.commentIntake.maxConsecutiveFailures,
        },
      });
      return 0;
    }

    if (!config.commentIntake.enabled) {
      // Explicitly disabled: not a failure, but say so loudly so a cron
      // operator does not mistake silence for progress.
      emit("run", { ok: true, disabled: true, results: [] });
      return 0;
    }

    const results = await service.runDue(new Date());
    const failures = results.filter((result) => "failed" in result && result.failed === true);
    const processed = results.filter((result) => !("skipped" in result));
    emit("run", {
      ok: failures.length === 0,
      sources: results.length,
      processed: processed.length,
      failures: failures.length,
      results,
    });
    return failures.length === 0 ? 0 : 1;
  } finally {
    await (db as unknown as { $client: { end(): Promise<void> } }).$client.end().catch(() => undefined);
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // Error text may embed driver internals; keep it but never echo env.
    process.stderr.write(`comment-intake-run failed: ${message}\n`);
    process.exitCode = 1;
  });
