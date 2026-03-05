import { createProvider, type ProviderType } from '../providers/index.js';
import { ChatMessage } from '../ui/chat-mode.js';
import { toolInputs } from '../tools/index.js';

// Words that strongly suggest a coding task (action verbs + subjects)
const TASK_VERBS = [
  'create', 'make', 'build', 'write', 'generate', 'scaffold', 'init', 'initialize',
  'fix', 'debug', 'repair', 'resolve', 'patch',
  'add', 'implement', 'integrate', 'install', 'setup', 'set up',
  'refactor', 'rewrite', 'rework', 'restructure', 'clean', 'cleanup',
  'delete', 'remove', 'drop',
  'update', 'modify', 'change', 'edit', 'rename', 'move',
  'test', 'run', 'execute', 'deploy', 'migrate',
];

const TASK_SUBJECTS = [
  'file', 'function', 'class', 'component', 'module', 'api', 'endpoint', 'route',
  'database', 'db', 'table', 'schema', 'model', 'controller', 'service',
  'test', 'spec', 'page', 'config', 'package', 'dependency',
  'bug', 'error', 'issue', 'feature', 'website', 'app', 'ui', 'code', 'logic',
  '.ts', '.js', '.tsx', '.jsx', '.py', '.json', '.css', '.html', '.md',
];

/**
 * Fast heuristic: returns true if the input looks like a coding task.
 * Zero latency — no LLM call needed.
 */
function isLikelyTask(input: string): boolean {
  const lower = input.toLowerCase();

  // Explicit task command
  if (lower.startsWith('/task ')) return true;

  // Short messages are almost never tasks
  if (lower.split(/\s+/).length < 3) return false;

  const hasVerb = TASK_VERBS.some((verb) => {
    // Check for standalone word match
    return new RegExp(`\\b${verb}\\b`).test(lower);
  });
  const hasSubject = TASK_SUBJECTS.some((subject) => lower.includes(subject));

  // If both a verb and subject are present, it's very likely a task
  if (hasVerb && hasSubject) return true;

  // Code file extensions mentioned directly
  if (/\.(ts|js|tsx|jsx|py|json|css|html|md|yaml|yml|sh|env)\b/.test(lower)) return true;

  return false;
}

/**
 * Fast heuristic: returns true if the input looks clearly conversational.
 * These get answered without an LLM classification call.
 */
function isClearlyChatty(input: string): boolean {
  const lower = input.toLowerCase().trim();
  const words = lower.split(/\s+/);

  // Greetings / short social messages
  const greetings = ['hi', 'hello', 'hey', 'thanks', 'thank you', 'thx', 'bye', 'ok', 'okay', 'cool', 'nice', 'great'];
  if (words.length <= 3 && greetings.some((g) => lower.includes(g))) return true;

  return false;
}

export async function processChatInput(
  input: string,
  providerName?: string,
  history: ChatMessage[] = [],
): Promise<{ isTask: boolean; response: string }> {
  try {
    if (!providerName) {
      return {
        isTask: false,
        response: 'No provider specified. Please configure a provider in your settings.',
      };
    }

    const trimmed = input.trim();

    // --- Fast paths (no LLM call needed) ---

    // 1. If user explicitly typed /task prefix, force task mode
    if (trimmed.toLowerCase().startsWith('/task ')) {
      return { isTask: true, response: trimmed.slice(6).trim() };
    }

    // 2. Strong task heuristic: skip LLM classification
    if (isLikelyTask(trimmed)) {
      return { isTask: true, response: trimmed };
    }

    // 3. Clearly conversational one-liners
    if (isClearlyChatty(trimmed)) {
      return { isTask: false, response: "Hey! How can I help you? If you want me to make changes to your code, just describe what you want and I'll get started." };
    }

    // --- Slow path: ambiguous, use LLM to classify + respond ---
    const validProviders: ProviderType[] = [
      'anthropic', 'google', 'openai', 'moonshot', 'ollama', 'groq', 'openrouter',
    ];
    if (!validProviders.includes(providerName as ProviderType)) {
      return { isTask: false, response: `Invalid provider: ${providerName}. Please configure a valid provider.` };
    }

    const provider = await createProvider(providerName as ProviderType);

    const systemPrompt = `You are Codo, a coding CLI assistant.
Determine if the user's message is:
- A TASK: a request to actively change, create, or interact with files/code (e.g. "Create a file", "Run a command", "Fix the bug", "Make the app functional") → start your reply with "[TASK]"
- CHAT: a question, explanation request, or general conversation → answer directly without "[TASK]"

You have access to tools. In CHAT mode, you may ONLY use read-only tools (read_file, list_files, list_directory, search_in_file) to inspect the workspace and answer questions. You CANNOT use write_file or run_command in CHAT mode.

If the user wants you to perform any changes or execute code, you MUST classify it as a TASK by starting your response with [TASK].
Be concise. For CHAT responses, keep answers under 3 sentences.`;

    const messages: any[] = [
      { role: 'system' as const, content: systemPrompt },
      ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: trimmed },
    ];

    let result = await provider.sendMessage(messages, toolInputs);
    let iterations = 0;

    while (result.toolCalls && result.toolCalls.length > 0 && iterations < 5) {
      iterations++;

      messages.push({
        role: 'assistant',
        content: result.content || '',
        toolCalls: result.toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          input: tc.input
        }))
      });

      const { executeTool } = await import('../tools/index.js');

      for (const tc of result.toolCalls) {
        let toolResult: string;
        if (['read_file', 'list_files', 'list_directory', 'search_in_file'].includes(tc.name)) {
          toolResult = await executeTool(tc.name, tc.input);
        } else {
          toolResult = `Error: Tool '${tc.name}' is only allowed in TASK mode. You are currently in CHAT mode. If you need to use this tool, please respond with [TASK] first.`;
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: toolResult
        });
      }

      result = await provider.sendMessage(messages, toolInputs);
    }

    const content = result.content.trim();

    if (content.startsWith('[TASK]')) {
      return { isTask: true, response: content.replace('[TASK]', '').trim() };
    }

    return { isTask: false, response: content };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { isTask: false, response: `Error processing chat input: ${message}` };
  }
}
