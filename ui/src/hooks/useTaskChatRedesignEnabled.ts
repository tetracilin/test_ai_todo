import { useContext } from "react";
import { QueryClient, QueryClientContext, useQuery } from "@tanstack/react-query";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";

let detachedClient: QueryClient | null = null;

function getDetachedClient(): QueryClient {
  detachedClient ??= new QueryClient();
  return detachedClient;
}

/**
 * Canonical Task Chat Redesign gate. The renewed Task View requires its
 * positive opt-in; the Classic Task Interface compatibility override wins.
 */
export function useTaskChatRedesignEnabled(): { enabled: boolean; loaded: boolean } {
  const contextClient = useContext(QueryClientContext);
  const { data, isError, isSuccess } = useQuery(
    {
      queryKey: queryKeys.instance.experimentalSettings,
      queryFn: () => instanceSettingsApi.getExperimental(),
      enabled: contextClient != null,
    },
    contextClient ?? getDetachedClient(),
  );

  if (!contextClient) {
    return { enabled: false, loaded: false };
  }

  return {
    enabled:
      !isError
      && data?.enableTaskChatRedesign === true
      && data.enableClassicTaskInterface !== true,
    loaded: isSuccess && !isError,
  };
}