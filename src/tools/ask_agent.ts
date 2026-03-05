import { taskBus } from '../a2a/index.js';

export const askAgentTool = {
    name: 'ask_agent',
    description: 'Ask another agent a specific question or ask for help. Note: In the current phase, this will just log the query to the Task Bus for preparation. Do not expect an immediate answer.',
    input_schema: {
        type: 'object',
        properties: {
            targetAgentId: {
                type: 'string',
                description: 'The ID of the agent you want to ask (or "broadcast" for all)',
            },
            query: {
                type: 'string',
                description: 'The question or request you have',
            },
        },
        required: ['targetAgentId', 'query'],
    },
};

export async function askAgentExecute(input: { targetAgentId: string; query: string }): Promise<string> {
    const message = {
        from: 'current-agent', // In the future, this will be dynamically populated with the actual sender's ID
        to: input.targetAgentId,
        content: input.query,
    };

    if (input.targetAgentId === 'broadcast') {
        taskBus.broadcastMessage(message);
    } else {
        taskBus.sendDirectMessage(message);
    }

    return `[A2A Prep] Query logged to Task Bus intended for ${input.targetAgentId}. Note: No reciprocal system is implemented yet, so you will not receive a reply in this loop.`;
}
