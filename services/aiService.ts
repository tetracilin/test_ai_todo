// Client-side AI orchestration via the Hermes Gateway. The browser never
// holds a model API key: requests go to the app server, which owns gateway
// credentials. If no gateway is configured, AI input degrades gracefully.

export interface AiOrchestrationResult {
    client_request_id: string;
    clarifications?: string[];
    work_package_title?: string;
    tasks: {
        title: string;
        note?: string;
        due_date?: string;
        scheduled_time?: string;
        estimate_minutes?: number;
        flagged?: boolean;
    }[];
}

const HERMES_ORCHESTRATE_URL = '/api/ai/orchestrate-task';

export const orchestrateTask = async (userPrompt: string): Promise<AiOrchestrationResult> => {
    const response = await fetch(HERMES_ORCHESTRATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: userPrompt }),
    });

    if (!response.ok) {
        let detail = `AI request failed (${response.status}).`;
        try {
            const body = await response.json();
            if (body && typeof body.error === 'string') {
                detail = body.error;
            }
        } catch {
            // Non-JSON error body; keep the status-based message.
        }
        throw new Error(detail);
    }

    const result = await response.json();
    if (!result || !result.client_request_id || !Array.isArray(result.tasks)) {
        throw new Error('Invalid response structure from AI.');
    }

    return result as AiOrchestrationResult;
};
