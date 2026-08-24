import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const describePostgres = adminUrl ? describe : describe.skip;
const baselineMigrationPath = fileURLToPath(new URL("./migrations/0227_nappy_doorman.sql", import.meta.url));
const migrationPath = fileURLToPath(new URL("./migrations/0228_mature_namora.sql", import.meta.url));
const databaseName = `paperclip_scheduling_${randomUUID().replaceAll("-", "")}`;

function databaseUrl(baseUrl: string, name: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

function migrationStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyMigration(sql: postgres.Sql, migration: string): Promise<void> {
  for (const statement of migrationStatements(migration)) {
    await sql.unsafe(statement);
  }
}

async function createPrerequisiteSchema(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE companies (id uuid PRIMARY KEY);
    CREATE TABLE issues (
      id uuid PRIMARY KEY,
      company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE
    );
    CREATE TABLE projects (
      id uuid PRIMARY KEY,
      company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE
    );
    CREATE TABLE agents (
      id uuid PRIMARY KEY,
      company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE
    );
  `);
}

async function expectConstraintViolation(action: () => Promise<unknown>): Promise<void> {
  await expect(action()).rejects.toMatchObject({ code: expect.stringMatching(/^23/) });
}

describePostgres("scheduling schema migration on PostgreSQL", () => {
  let admin!: postgres.Sql;
  let sql!: postgres.Sql;
  let migration!: string;

  beforeAll(async () => {
    admin = postgres(adminUrl!, { max: 1 });
    await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
    sql = postgres(databaseUrl(adminUrl!, databaseName), { max: 1 });
    migration = await readFile(migrationPath, "utf8");
    await createPrerequisiteSchema(sql);
    await applyMigration(sql, await readFile(baselineMigrationPath, "utf8"));
  });

  afterAll(async () => {
    await sql?.end();
    if (admin) {
      await admin.unsafe(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()`,
      );
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await admin.end();
    }
  });

  it("rolls back cleanly before applying the migration", async () => {
    await sql.unsafe("BEGIN");
    await applyMigration(sql, migration);
    await sql.unsafe("ROLLBACK");

    const timezoneAfterRollback = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'scheduling_routines'
        AND column_name = 'timezone'
    `;
    expect(timezoneAfterRollback).toEqual([]);

    await applyMigration(sql, migration);
    const timezoneAfterApply = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'scheduling_routines'
        AND column_name = 'timezone'
    `;
    expect(timezoneAfterApply).toEqual([{ column_name: "timezone" }]);
  });

  it("enforces one scheduling row per issue, tenant FKs, positive durations, defaults, and indexes", async () => {
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const issueId = randomUUID();
    await sql`INSERT INTO companies (id) VALUES (${companyId}), (${otherCompanyId})`;
    await sql`INSERT INTO issues (id, company_id) VALUES (${issueId}, ${companyId})`;

    await sql`
      INSERT INTO issue_scheduling (issue_id, company_id, scheduled_at, scheduled_duration_minutes)
      VALUES (${issueId}, ${companyId}, ${"2026-11-01 01:30:00-07"}, ${30})
    `;

    const rows = await sql<{
      scheduled_utc: string;
      defer_until: string | null;
      created_at: Date;
      updated_at: Date;
    }[]>`
      SELECT
        to_char(scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') AS scheduled_utc,
        defer_until,
        created_at,
        updated_at
      FROM issue_scheduling
      WHERE issue_id = ${issueId}
    `;
    expect(rows[0]?.scheduled_utc).toBe("2026-11-01 08:30:00");
    expect(rows[0]?.defer_until).toBeNull();
    expect(rows[0]?.created_at).toBeInstanceOf(Date);
    expect(rows[0]?.updated_at).toBeInstanceOf(Date);

    await expectConstraintViolation(() =>
      sql`INSERT INTO issue_scheduling (issue_id, company_id) VALUES (${issueId}, ${companyId})`,
    );
    await sql`DELETE FROM issue_scheduling WHERE issue_id = ${issueId}`;

    await expectConstraintViolation(() =>
      sql`INSERT INTO issue_scheduling (issue_id, company_id) VALUES (${issueId}, ${otherCompanyId})`,
    );
    await expectConstraintViolation(() =>
      sql`
        INSERT INTO issue_scheduling (issue_id, company_id, scheduled_duration_minutes)
        VALUES (${issueId}, ${companyId}, ${0})
      `,
    );

    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'issue_scheduling'
    `;
    expect(indexes.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "issue_scheduling_company_scheduled_at_idx",
        "issue_scheduling_company_defer_until_idx",
      ]),
    );
  });

  it("stores recurrence fields with UTC timezone default and enforces routine FK behavior", async () => {
    const companyId = randomUUID();
    const otherCompanyId = randomUUID();
    const projectId = randomUUID();
    const agentId = randomUUID();
    const routineId = randomUUID();
    await sql`INSERT INTO companies (id) VALUES (${companyId}), (${otherCompanyId})`;
    await sql`INSERT INTO projects (id, company_id) VALUES (${projectId}, ${companyId})`;
    await sql`INSERT INTO agents (id, company_id) VALUES (${agentId}, ${companyId})`;

    await sql`
      INSERT INTO scheduling_routines (
        id, company_id, project_id, title, assignee_agent_id,
        recurrence_rule, scheduled_time, estimate_minutes
      ) VALUES (
        ${routineId}, ${companyId}, ${projectId}, ${"Weekly planning"}, ${agentId},
        ${JSON.stringify({ kind: "weekly", daysOfWeek: [1, 3] })}::jsonb, ${"09:30"}, ${45}
      )
    `;

    const routines = await sql<{
      priority: string;
      status: string;
      timezone: string;
      scheduled_time: string;
      last_generated_for_date: string | null;
    }[]>`
      SELECT priority, status, timezone, scheduled_time::text, last_generated_for_date::text
      FROM scheduling_routines
      WHERE id = ${routineId}
    `;
    expect(routines[0]).toMatchObject({
      priority: "medium",
      status: "active",
      timezone: "UTC",
      scheduled_time: "09:30",
      last_generated_for_date: null,
    });

    await expectConstraintViolation(() =>
      sql`
        INSERT INTO scheduling_routines (company_id, project_id, title, recurrence_rule)
        VALUES (${otherCompanyId}, ${projectId}, ${"Wrong tenant project"}, ${JSON.stringify({ kind: "daily" })}::jsonb)
      `,
    );
    await expectConstraintViolation(() =>
      sql`
        INSERT INTO scheduling_routines (company_id, title, assignee_agent_id, recurrence_rule)
        VALUES (${otherCompanyId}, ${"Wrong tenant agent"}, ${agentId}, ${JSON.stringify({ kind: "daily" })}::jsonb)
      `,
    );
    await expectConstraintViolation(() =>
      sql`
        INSERT INTO scheduling_routines (company_id, title, recurrence_rule, estimate_minutes)
        VALUES (${companyId}, ${"Zero estimate"}, ${JSON.stringify({ kind: "daily" })}::jsonb, ${0})
      `,
    );

    await sql`DELETE FROM agents WHERE id = ${agentId}`;
    const afterAgentDelete = await sql<{ assignee_agent_id: string | null }[]>`
      SELECT assignee_agent_id FROM scheduling_routines WHERE id = ${routineId}
    `;
    expect(afterAgentDelete[0]?.assignee_agent_id).toBeNull();

    await sql`DELETE FROM projects WHERE id = ${projectId}`;
    const afterProjectDelete = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM scheduling_routines WHERE id = ${routineId}
    `;
    expect(afterProjectDelete[0]?.count).toBe(0);

    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'scheduling_routines'
    `;
    expect(indexes.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "scheduling_routines_company_status_idx",
        "scheduling_routines_company_assignee_idx",
        "scheduling_routines_company_project_idx",
      ]),
    );
  });

  it("cascades issue deletion without deleting unrelated scheduling routines", async () => {
    const companyId = randomUUID();
    const issueId = randomUUID();
    await sql`INSERT INTO companies (id) VALUES (${companyId})`;
    await sql`INSERT INTO issues (id, company_id) VALUES (${issueId}, ${companyId})`;
    await sql`INSERT INTO issue_scheduling (issue_id, company_id) VALUES (${issueId}, ${companyId})`;
    await sql`
      INSERT INTO scheduling_routines (company_id, title, recurrence_rule)
      VALUES (${companyId}, ${"Daily"}, ${JSON.stringify({ kind: "daily" })}::jsonb)
    `;

    await sql`DELETE FROM issues WHERE id = ${issueId}`;
    const remaining = await sql<{ scheduling_count: number; routine_count: number }[]>`
      SELECT
        (SELECT count(*)::int FROM issue_scheduling WHERE company_id = ${companyId}) AS scheduling_count,
        (SELECT count(*)::int FROM scheduling_routines WHERE company_id = ${companyId}) AS routine_count
    `;
    expect(remaining[0]).toEqual({ scheduling_count: 0, routine_count: 1 });
  });
});
