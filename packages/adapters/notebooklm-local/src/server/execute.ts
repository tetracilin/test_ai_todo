import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";

// SCAFFOLD ONLY (NLM-A03): no execute behavior yet. Real argv construction,
// env/profile injection, JSON/raw output handling, timeouts, and output caps
// are implemented in NLM-A04 per the canonical plan. This stub exists so the
// package builds/typechecks and exports the shape `ServerAdapterModule`
// expects; it must never be wired into a selectable/dispatchable agent path
// before NLM-A04 lands.
export async function execute(
  _ctx: AdapterExecutionContext,
): Promise<AdapterExecutionResult> {
  throw new Error(
    "notebooklm_local adapter execute() is not implemented yet (scaffold only, see NLM-A04)",
  );
}
