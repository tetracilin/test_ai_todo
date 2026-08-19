import { AgentAdapter, Agent, InvocationContext, InvokeResult, RunStatus, HeartbeatRun } from '@paperclip/shared';

export class OpenRouterAdapter implements AgentAdapter {
  async invoke(agent: Agent, context: InvocationContext): Promise<InvokeResult> {
    // Implementation for OpenRouter API invocation
    const config = agent.adapter_config as { 
      model: string,
      api_key: string,
      timeout_sec: number
    };

    // Validate company scoping
    if (!context.companyId || agent.company_id !== context.companyId) {
      throw new Error('Agent company mismatch');
    }

    try {
      // Implement OpenRouter API call here
      // Example:
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.api_key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.model,
          messages: context.messages,
          timeout: config.timeout_sec * 1000
        })
      });

      const data = await response.json();
      
      return {
        success: true,
        output: JSON.stringify(data),
        metadata: {
          model: config.model,
          companyId: agent.company_id
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metadata: {
          companyId: agent.company_id
        }
      };
    }
  }

  async status(run: HeartbeatRun): Promise<RunStatus> {
    // Implement status check for OpenRouter runs
    // This would typically check a database or API for run status
    return {
      status: run.status,
      progress: run.progress || 0,
      metadata: {
        adapter: 'openrouter',
        companyId: run.company_id
      }
    };
  }

  async cancel(run: HeartbeatRun): Promise<void> {
    // Implement cancellation logic for OpenRouter runs
    // This would typically send a cancellation request to the OpenRouter API
    console.log(`Cancelling OpenRouter run ${run.id} for company ${run.company_id}`);
    // Add actual cancellation implementation here
  }
}