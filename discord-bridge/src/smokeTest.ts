/**
 * Live integration smoke test against the real Paperclip API — proves the
 * bridge's Paperclip-facing half (issue lookup, Mine inbox, comments with
 * onBehalfOfUserId, interactions) actually works, without needing a Discord
 * bot token. Run with Paperclip credentials in the environment, e.g. from an
 * agent heartbeat run:
 *
 *   PAPERCLIP_API_URL=$PAPERCLIP_API_URL \
 *   PAPERCLIP_API_KEY=$PAPERCLIP_API_KEY \
 *   PAPERCLIP_COMPANY_ID=$PAPERCLIP_COMPANY_ID \
 *   SMOKE_TEST_USER_ID=<a real paperclip user id in this company> \
 *   SMOKE_TEST_PARENT_ISSUE_ID=<optional parent issue id> \
 *   npm run smoke-test
 *
 * This intentionally does not import ./config.ts, which also demands Discord
 * env vars this test doesn't need.
 */
import "dotenv/config";
import { PaperclipClient } from "./lib/paperclipClient.js";
import { handleApprove, handleLink, handlePlate, handleReply, handleStatus } from "./lib/handlers.js";
import { LinkStore } from "./lib/linkStore.js";

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`smoke test needs ${name} in the environment`);
  return v;
}

async function main() {
  const apiUrl = need("PAPERCLIP_API_URL").replace(/\/+$/, "").replace(/\/api$/, "");
  const apiKey = need("PAPERCLIP_API_KEY");
  const companyId = need("PAPERCLIP_COMPANY_ID");
  const userId = need("SMOKE_TEST_USER_ID");
  const parentIssueId = process.env.SMOKE_TEST_PARENT_ISSUE_ID;
  const goalId = process.env.SMOKE_TEST_GOAL_ID;
  const runId = process.env.PAPERCLIP_RUN_ID;

  const paperclip = new PaperclipClient({ apiUrl, apiKey, companyId });
  const store = new LinkStore(":memory:");
  const ctx = { paperclip, store, issuePrefix: process.env.PAPERCLIP_ISSUE_PREFIX || "T", dashboardUrl: apiUrl };

  let pass = 0;
  let fail = 0;
  const check = (label: string, ok: boolean, detail?: unknown) => {
    if (ok) {
      pass++;
      console.log(`  ok  - ${label}`);
    } else {
      fail++;
      console.log(`  FAIL - ${label}`, detail ?? "");
    }
  };

  console.log(`1) create a throwaway test issue as user ${userId}`);
  const created = await paperclip.createIssue({
    title: `[discord-bridge smoke test] ${new Date().toISOString()}`,
    description: "Created by discord-bridge/src/smokeTest.ts to verify live Paperclip API integration.",
    assigneeUserId: userId,
    createdByUserId: userId,
    ...(parentIssueId ? { parentId: parentIssueId } : {}),
    ...(goalId ? { goalId } : {}),
  });
  check("issue created with an identifier", Boolean(created.identifier), created);

  console.log(`2) link discord user "smoke-test-discord-user" -> paperclip user ${userId}`);
  const linkReply = await handleLink(ctx, "smoke-test-discord-user", "smoke-test-channel", userId);
  check("link succeeded", /Linked!/.test(linkReply), linkReply);

  console.log("3) /plate shows the newly created issue");
  const plateReply = await handlePlate(ctx, "smoke-test-discord-user");
  check("plate includes the new issue", plateReply.includes(created.identifier), plateReply);

  console.log(`4) /status ${created.identifier} before any comments`);
  const statusReply = await handleStatus(ctx, "smoke-test-discord-user", created.identifier);
  check("status shows the issue", statusReply.includes(created.identifier), statusReply);

  console.log(`5) /reply on ${created.identifier} (with human identity folded into the body)`);
  const replyReply = await handleReply(
    ctx,
    "smoke-test-discord-user",
    "Smoke Test Human",
    created.identifier,
    "Smoke-test comment posted from Discord.",
  );
  check("reply posted", /Posted your comment/.test(replyReply), replyReply);

  const comments = await paperclip.getComments(created.id, { order: "desc" });
  const posted = comments[0];
  check(
    "posted comment body carries the linked human's identity (API rejects onBehalfOfUserId from agents — see paperclipClient.ts)",
    typeof posted?.body === "string" && posted.body.includes("Smoke Test Human"),
    posted,
  );

  console.log(`6) /approve ${created.identifier} with no pending confirmation`);
  const approveReply = await handleApprove(ctx, "smoke-test-discord-user", created.identifier);
  check("approve reports nothing pending", /No pending confirmation/.test(approveReply), approveReply);

  console.log(`7) close the test issue (PATCH, not part of the bridge's own API surface)`);
  const patchRes = await fetch(`${apiUrl}/api/issues/${created.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(runId ? { "X-Paperclip-Run-Id": runId } : {}),
    },
    body: JSON.stringify({
      status: "done",
      comment: "Closing discord-bridge smoke-test issue; verification complete.",
    }),
  });
  check("test issue closed", patchRes.ok, await patchRes.text().catch(() => ""));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(1);
});
