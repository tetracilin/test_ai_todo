import { AGENT_DEFAULT_MAX_CONCURRENT_RUNS } from "@paperclipai/shared";
import { defaultCreateValues } from "../components/agent-config-defaults";

export function buildNewAgentRuntimeConfig(input?: {
  adapterType?: string;
  heartbeatEnabled?: boolean;
  intervalSec?: number;
  cheapModel?: string;
  cheapModelEnabled?: boolean;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {
    heartbeat: {
      enabled: input?.heartbeatEnabled ?? defaultCreateValues.heartbeatEnabled,
      intervalSec: input?.intervalSec ?? defaultCreateValues.intervalSec,
      wakeOnDemand: true,
      skipTimerWhenNoActionableWork: true,
      cooldownSec: 10,
      maxConcurrentRuns:
        input?.adapterType === "hermes_gateway" ? 1 : AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
    },
  };

  const cheapModel = input?.cheapModel?.trim() ?? "";
  const cheapEnabled = input?.cheapModelEnabled ?? false;
  if (cheapEnabled) {
    config.modelProfiles = {
      cheap: {
        enabled: true,
        adapterConfig: cheapModel ? { model: cheapModel } : {},
      },
    };
  }

  return config;
}
