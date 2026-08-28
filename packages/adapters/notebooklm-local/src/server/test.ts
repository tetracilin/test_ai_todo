import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";

// SCAFFOLD ONLY (NLM-A03): real binary-identity / profile-store / `nlm login
// --check` probing is implemented in NLM-A05 per the canonical plan. Until
// then this always reports "fail" with an explicit not-implemented check so
// the adapter can never look silently healthy while unimplemented.
export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  return {
    adapterType: ctx.adapterType,
    status: "fail",
    checks: [
      {
        code: "notebooklm_local_not_implemented",
        level: "error",
        message: "notebooklm_local adapter is a scaffold (NLM-A03); testEnvironment() is not implemented yet.",
        hint: "See NLM-A05 (implement testEnvironment()) in the canonical NotebookLM adapter plan.",
      },
    ],
    testedAt: new Date().toISOString(),
  };
}
