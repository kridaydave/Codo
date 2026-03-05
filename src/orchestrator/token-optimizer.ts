import { createProvider, type ProviderType } from '../providers/index.js';

export class TokenOptimizer {
    /**
     * Optimizes the original task context for a specific subtask using an LLM.
     * If the original task is short enough, it simply returns the subtask or combined text
     * to save latency and API calls.
     */
    static async optimizeDelegation(
        originalTask: string,
        subtask: string,
        providerType: ProviderType
    ): Promise<string> {
        // If original task is quite short, just combine them or return subtask
        // to avoid an unnecessary LLM call overhead.
        if (originalTask.length < 200) {
            if (originalTask.includes(subtask)) {
                return originalTask;
            }
            return `Original context: ${originalTask}\n\nYour specific subtask: ${subtask}`;
        }

        try {
            const provider = await createProvider(providerType);

            const systemPrompt = `You are an AI task optimizer. 
Your goal is to extract only the necessary context from an 'Original Task' that is required to complete a specific 'Subtask'. 
Drop any irrelevant requirements, pleasantries, or instructions meant for other sub-agents. 
Output ONLY the optimized prompt that should be given to the developer agent assigned to this Subtask. Do not include any meta-commentary.`;

            const userMessage = `Original Task:
${originalTask}

Specific Subtask to optimize for:
${subtask}

Please provide the optimized task description for the sub-agent.`;

            const response = await provider.sendMessage(
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                []
            );

            const optimized = response.content.trim();
            return optimized || subtask; // fallback to subtask if empty
        } catch (error) {
            // In case of any error (network, rate limit, etc), fallback safely
            return `Context: ${originalTask}\n\nTask: ${subtask}`;
        }
    }
}
