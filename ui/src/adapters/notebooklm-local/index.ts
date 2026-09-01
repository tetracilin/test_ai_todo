import type { UIAdapterModule } from "../types";
import {
  buildNotebookLmLocalConfig,
  parseNotebookLmLocalStdoutLine,
} from "@paperclipai/adapter-notebooklm-local/ui";
import { SchemaConfigFields } from "../schema-config-fields";

// NLM-A06: registers the notebooklm_local UI adapter using the generic
// schema-driven config form (same pattern as hermes_local/hermes_gateway/
// cursor_cloud) — the adapter's getConfigSchema() (NLM-A04) already
// describes every field, so no bespoke ConfigFields component is needed.
export const notebookLmLocalUIAdapter: UIAdapterModule = {
  type: "notebooklm_local",
  label: "NotebookLM",
  parseStdoutLine: parseNotebookLmLocalStdoutLine,
  ConfigFields: SchemaConfigFields,
  buildAdapterConfig: buildNotebookLmLocalConfig,
};
