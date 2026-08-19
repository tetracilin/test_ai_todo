import { AgentAdapter } from '@paperclip/shared';
import { ProcessAdapter } from './process-adapter';
import { HttpAdapter } from './http-adapter';
import { OpenRouterAdapter } from './openrouter-adapter';

export const adapters: Record<string, new () => AgentAdapter> = {
  process: ProcessAdapter,
  http: HttpAdapter,
  openrouter: OpenRouterAdapter,
};

export { ProcessAdapter, HttpAdapter, OpenRouterAdapter };
