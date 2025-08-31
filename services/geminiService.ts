import { GoogleGenAI, Type } from "@google/genai";
import { Item, ItemType, WorkPackageType } from "../types";

if (!process.env.API_KEY) {
  console.warn("API_KEY environment variable not set. AI features will be disabled.");
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

const subtaskSchema = {
  type: Type.OBJECT,
  properties: {
    tasks: {
      type: Type.ARRAY,
      description: "A list of actionable sub-tasks.",
      items: {
        type: Type.STRING,
        description: "A single, short, actionable task title."
      }
    }
  },
  required: ['tasks']
};

export const generateSubTasks = async (masterPrompt: string, workPackageTitle: string): Promise<string[]> => {
  if (!process.env.API_KEY) {
    throw new Error("Gemini API key is not configured.");
  }

  try {
    const prompt = `${masterPrompt}\n\nWork Package Title: "${workPackageTitle}"`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: subtaskSchema,
      },
    });

    const jsonText = response.text.trim();
    const result = JSON.parse(jsonText);

    if (result && Array.isArray(result.tasks)) {
      return result.tasks;
    } else {
      console.error("Unexpected JSON structure from Gemini API:", result);
      return [];
    }
  } catch (error) {
    console.error("Error generating sub-tasks with Gemini:", error);
    if (error instanceof Error) {
        if(error.message.includes('API key not valid')) {
            throw new Error("The provided Gemini API key is not valid. Please check your configuration.");
        }
        throw new Error(`Failed to generate sub-tasks: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the Gemini API.");
  }
};

export const generateTaskSteps = async (masterPrompt: string, taskTitle: string, userPrompt: string): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("Gemini API key is not configured.");
  }

  try {
    const prompt = masterPrompt
      .replace('{taskName}', `"${taskTitle}"`)
      .replace('{userPrompt}', userPrompt);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text;
    if (!text) {
        throw new Error("Received an empty response from the AI.");
    }

    return text;
  } catch (error) {
    console.error("Error generating task steps with Gemini:", error);
    if (error instanceof Error) {
        if(error.message.includes('API key not valid')) {
            throw new Error("The provided Gemini API key is not valid. Please check your configuration.");
        }
        throw new Error(`Failed to generate task steps: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the Gemini API.");
  }
};


const aiTaskCreationSchema = {
    type: Type.OBJECT,
    properties: {
        client_request_id: { 
            type: Type.STRING, 
            description: "A UUID v4 you generate for idempotency."
        },
        clarifications: {
            type: Type.ARRAY,
            description: "An array of strings explaining any assumptions you made due to ambiguous instructions.",
            items: { type: Type.STRING }
        },
        work_package_title: {
            type: Type.STRING,
            description: "The title for a new work package if the request is a larger goal. Omit if not applicable."
        },
        tasks: {
            type: Type.ARRAY,
            description: "A list of tasks to be created.",
            items: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING },
                    note: { type: Type.STRING },
                    due_date: { 
                        type: Type.STRING,
                        description: "The due date in ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ). Use Asia/Bangkok timezone if not specified by user."
                    },
                    scheduled_time: {
                        type: Type.STRING,
                        description: "The specific time for the task in HH:mm format. Should correspond to the due_date."
                    },
                    estimate_minutes: { type: Type.NUMBER },
                    flagged: { type: Type.BOOLEAN, description: "Set to true if the user implies high priority." }
                },
                required: ['title']
            }
        }
    },
    required: ['client_request_id', 'tasks']
};

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

export const orchestrateTaskWithGemini = async (userPrompt: string): Promise<AiOrchestrationResult> => {
    if (!process.env.API_KEY) {
        throw new Error("Gemini API key is not configured.");
    }
    
    const systemInstruction = `You are the Task Orchestrator for a mobile-first todo app.
Objective: Turn user intent into structured actions: create tasks, plan substeps, and schedule them.
How:
- Always produce structured JSON using the provided tool schemas.
- Prefer leverage: batch similar operations, re-use templates, and avoid redundant work.
- Be explicit with timezones: default to Asia/Bangkok when the user does not specify one.
- Parse dates from natural language into ISO 8601 format (e.g., YYYY-MM-DDTHH:mm:ss.sssZ).
- If an instruction is ambiguous, choose the safest, reversible interpretation and include a clarifications field with what you assumed.
- Keep outputs idempotent by including a client_request_id (UUID v4 you generate).
- Strictly conform to the tool JSON schemas; do not add extra keys.

High-level policy:
- If the user gives a goal (e.g., “Ship client demo next Friday”), break it down into a work package with multiple tasks.
- If the user gives simple tasks (e.g., "remind me to call John tomorrow at 5pm"), just create the tasks.
`;
    
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: userPrompt,
            config: {
                systemInstruction,
                responseMimeType: 'application/json',
                responseSchema: aiTaskCreationSchema,
            }
        });

        const jsonText = response.text.trim();
        const result = JSON.parse(jsonText);
        
        // Basic validation
        if (!result.client_request_id || !Array.isArray(result.tasks)) {
            throw new Error("Invalid response structure from AI.");
        }
        
        return result as AiOrchestrationResult;

    } catch (error) {
        console.error("Error orchestrating tasks with Gemini:", error);
        if (error instanceof Error) {
            if(error.message.includes('API key not valid')) {
                throw new Error("The provided Gemini API key is not valid. Please check your configuration.");
            }
            throw new Error(`Failed to generate tasks: ${error.message}`);
        }
        throw new Error("An unknown error occurred while communicating with the Gemini API.");
    }
};
