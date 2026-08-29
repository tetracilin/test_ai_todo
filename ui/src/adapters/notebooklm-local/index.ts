import type { UIAdapterModule } from "../types";
import { parseNotebookLmLocalStdoutLine } from "@paperclipai/adapter-notebooklm-local/ui";
import { SchemaConfigFields, buildSchemaAdapterConfig } from "../schema-config-fields";

// NLM-A06: registers the notebooklm_local UI adapter using the generic
// schema-driven config form (same pattern as hermes_local/hermes_gateway/
// cursor_cloud) — the adapter's getConfigSchema() (NLM-A04) already
// describes every field, so no bespoke ConfigFields component is needed.
// Transcript rendering stays on the NLM-A03 raw-stdout-line scaffold until
// NLM-A07 implements real JSON/raw transcript rendering.
export const notebookLmLocalUIAdapter: UIAdapterModule = {
  type: "notebooklm_local",
  label: "NotebookLM (local)",
  parseStdoutLine: parseNotebookLmLocalStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildSchemaAdapterConfig,
};
