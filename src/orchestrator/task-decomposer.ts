import { createProvider, type ProviderType } from '../providers/index.js';

export interface TaskDecomposition {
    subtasks: string[];
    agentCount: number;
    method: 'heuristic' | 'llm' | 'single';
}

// Action verbs that strongly indicate a new independent task
const TASK_VERBS = [
    'create', 'add', 'write', 'build', 'make', 'generate', 'implement',
    'fix', 'update', 'refactor', 'delete', 'remove', 'rename', 'move',
    'test', 'deploy', 'install', 'configure', 'setup', 'connect', 'integrate',
];

const TASK_VERB_PATTERN = new RegExp(
    `\\b(${TASK_VERBS.join('|')})\\b`,
    'i',
);

/**
 * Phase 1: Deterministic heuristic splitter. Never fails. Zero latency.
 * Splits on explicit structural separators in the task text.
 */
function heuristicSplit(task: string, maxAgents: number): string[] | null {
    // --- Strategy 1: Numbered list  (1. ... 2. ... 3. ...) ---
    const numberedMatch = task.match(/^(?:\d+[\.\)]\s+.+?)(?:\s+\d+[\.\)]\s+.+?)+$/s);
    if (numberedMatch) {
        const parts = task.split(/\s+(?=\d+[\.\)]\s)/).map((s) => s.replace(/^\d+[\.\)]\s+/, '').trim()).filter(Boolean);
        if (parts.length > 1) return parts.slice(0, maxAgents);
    }

    // --- Strategy 2: Newline-separated items that start with a verb or bullet ---
    const lines = task.split(/\n+/).map((l) => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
    if (lines.length > 1 && lines.every((l) => TASK_VERB_PATTERN.test(l))) {
        return lines.slice(0, maxAgents);
    }

    // --- Strategy 3: Explicit hard conjunctions ---
    const hardSplitters = [
        / and also /gi,
        / as well as /gi,
        / additionally[,.]? /gi,
        / furthermore[,.]? /gi,
        /;\s*/g,
    ];
    for (const splitter of hardSplitters) {
        const parts = task.split(splitter).map((s) => s.trim()).filter((s) => s.length > 5);
        if (parts.length > 1) return parts.slice(0, maxAgents);
    }

    // --- Strategy 4: Comma + independent verb  (", create ...", ", add ...") ---
    // Detects patterns like "do X, create Y, and add Z"
    const commaParts = task.split(/,\s+(?:and\s+)?(?=\w)/i).map((s) => s.trim()).filter(Boolean);
    if (
        commaParts.length > 1 &&
        commaParts.every((p) => TASK_VERB_PATTERN.test(p))
    ) {
        return commaParts.slice(0, maxAgents);
    }

    // --- Strategy 5: " and " split ---
    // Handles:
    //   "fix the login bug AND add the profile page" (both verb-led)
    //   "add dummy accounts to DB AND a booking endpoint to app" (first verb-led, second noun phrase)
    // Does NOT split: "create a page with forms and validation" (short, single subject)
    const andParts = task.split(/ and /i).map((s) => s.trim()).filter((s) => s.length > 4);
    if (andParts.length > 1 && andParts.length <= maxAgents) {
        // Gate: the overall task must be long enough (avoid splitting "fix X and Y" into 2 trivial halves)
        const longEnough = task.split(/\s+/).length >= 8;
        // Gate: at least the FIRST part must start with or contain an action verb
        const firstPartHasVerb = TASK_VERB_PATTERN.test(andParts[0]);
        // Gate: each part must be a substantial phrase (>= 4 words)
        const allSubstantial = andParts.every((p) => p.split(/\s+/).length >= 3);
        if (longEnough && firstPartHasVerb && allSubstantial) {
            return andParts.slice(0, maxAgents);
        }
    }

    return null; // No split detected
}

/**
 * Phase 2: LLM-based decomposition for longer ambiguous prompts.
 * Falls back gracefully to [task] on any error.
 */
async function llmSplit(task: string, provider: ProviderType, maxAgents: number): Promise<string[]> {
    try {
        const llmProvider = await createProvider(provider);

        const result = await llmProvider.sendMessage(
            [
                {
                    role: 'system',
                    content: `Split the coding task into at most ${maxAgents} independent subtasks that different agents can do in parallel. Each subtask must be self-contained. Return ONLY a JSON array of strings, e.g. ["task1","task2"]. If it's one cohesive task, return ["<original task>"] with the full text.`,
                },
                { role: 'user', content: task },
            ],
            [],
        );

        const match = result.content.trim().match(/\[[\s\S]*?\]/);
        if (!match) return [task];

        const parsed: string[] = JSON.parse(match[0]);
        if (!Array.isArray(parsed) || parsed.length === 0) return [task];

        return parsed.filter((s) => typeof s === 'string' && s.trim()).slice(0, maxAgents);
    } catch {
        return [task];
    }
}

/**
 * Main entry point.
 * Guarantees multi-agent split for clearly multi-part tasks.
 * Uses heuristic Phase 1 first (instant, never fails), then LLM Phase 2 only for complex long prompts.
 */
export async function decomposeTasks(
    task: string,
    provider: ProviderType,
    maxAgents: number = 4,
): Promise<TaskDecomposition> {
    // Phase 1: instant heuristic
    const heuristic = heuristicSplit(task, maxAgents);
    if (heuristic && heuristic.length > 1) {
        return { subtasks: heuristic, agentCount: heuristic.length, method: 'heuristic' };
    }

    // Phase 2: LLM for longer prompts (> 20 words) where heuristic couldn't split
    const wordCount = task.split(/\s+/).length;
    if (wordCount > 20) {
        const subtasks = await llmSplit(task, provider, maxAgents);
        if (subtasks.length > 1) {
            return { subtasks, agentCount: subtasks.length, method: 'llm' };
        }
    }

    // Single task
    return { subtasks: [task], agentCount: 1, method: 'single' };
}
