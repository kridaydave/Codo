import { createProvider } from '../providers/index.js';
import { ChatMessage } from '../ui/chat-mode.js';

export async function processChatInput(input: string, providerName?: string, history: ChatMessage[] = []): Promise<{ isTask: boolean, response: string }> {
    const provider = await createProvider(providerName as any);

    const systemPrompt = `You are Codo, an intelligent coding CLI.
The user is talking to you in chat mode. 
Determine if the user's input is a conversational inquiry (e.g., asking a question about programming, asking for an explanation, saying hi) OR if it is a request to perform actions on their codebase (e.g., "build me a login page", "fix the bug in x.ts", "refactor my code").
If it is a conversational inquiry, provide a helpful, concise answer.
If it is a request to perform actions or write code to files, you MUST start your response with the exact string "[TASK]".

Remember: 
- Answer questions directly.
- NEVER prefix with [TASK] unless the user is asking you to modify, create, or actively interact with files/codebase.`;

    const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...history.map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content: input }
    ];

    const result = await provider.sendMessage(messages, []);
    const content = result.content.trim();

    if (content.startsWith('[TASK]')) {
        return { isTask: true, response: content.replace('[TASK]', '').trim() };
    }

    return { isTask: false, response: content };
}
