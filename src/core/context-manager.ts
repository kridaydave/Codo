import type { Message } from '../providers/types.js';
import type { ProviderType } from '../config/config.js';

/**
 * Known context window sizes (in tokens) for each provider's default model.
 * Conservative estimates — uses the model's input limit, not total.
 */
const CONTEXT_WINDOWS: Record<string, number> = {
    anthropic: 200_000,
    gemini: 1_000_000,
    google: 1_000_000,
    openai: 128_000,
    moonshot: 8_000,
    ollama: 8_000,
    groq: 8_000,
    openrouter: 128_000,
    opencode: 128_000,
};

/** Rough chars-per-token ratio. Conservative (overestimates tokens). */
const CHARS_PER_TOKEN = 3.5;

/** Default: start trimming when context hits 75% of window. */
const DEFAULT_WARNING_THRESHOLD = 0.75;

/** Max tokens for a single tool result before truncation. ~16K chars. */
const MAX_TOOL_RESULT_TOKENS = 4_000;

/** Number of oldest non-system messages to summarize at a time. */
const SUMMARIZE_BATCH_SIZE = 6;

export class ContextManager {
    private maxTokens: number;
    private warningThreshold: number;

    constructor(provider?: ProviderType, maxTokens?: number) {
        this.maxTokens = maxTokens ?? CONTEXT_WINDOWS[provider ?? 'gemini'] ?? 128_000;
        this.warningThreshold = DEFAULT_WARNING_THRESHOLD;
    }

    /** Estimate token count for a single string. */
    estimateStringTokens(text: string): number {
        return Math.ceil(text.length / CHARS_PER_TOKEN);
    }

    /** Estimate total token count across all messages. */
    estimateTokens(messages: Message[]): number {
        let total = 0;
        for (const msg of messages) {
            // Content
            total += this.estimateStringTokens(msg.content);
            // Tool calls add overhead
            if (msg.toolCalls) {
                for (const tc of msg.toolCalls) {
                    total += this.estimateStringTokens(JSON.stringify(tc.input ?? {}));
                    total += this.estimateStringTokens(tc.name);
                }
            }
        }
        return total;
    }

    /** Check if current token usage exceeds the warning threshold. */
    shouldTrim(messages: Message[]): boolean {
        const usage = this.estimateTokens(messages);
        return usage > this.maxTokens * this.warningThreshold;
    }

    /** Get current usage as a fraction of the context window (0-1+). */
    getUsageRatio(messages: Message[]): number {
        return this.estimateTokens(messages) / this.maxTokens;
    }

    /**
     * Summarise the oldest non-system messages into a compact recap.
     * Returns a new messages array with the oldest batch replaced by a summary.
     */
    summarizeOldest(messages: Message[]): Message[] {
        if (messages.length <= 3) return messages; // nothing to trim

        const systemMsg = messages[0]?.role === 'system' ? messages[0] : null;
        const nonSystem = systemMsg ? messages.slice(1) : [...messages];

        if (nonSystem.length <= 2) return messages; // keep at least the most recent pair

        const batchSize = Math.min(SUMMARIZE_BATCH_SIZE, nonSystem.length - 2);
        const toSummarize = nonSystem.slice(0, batchSize);
        const remaining = nonSystem.slice(batchSize);

        // Build a condensed recap of what was discussed/done
        const recapParts: string[] = [];
        for (const msg of toSummarize) {
            if (msg.role === 'assistant' && msg.content) {
                // Keep first 200 chars of assistant thoughts
                recapParts.push(`[Assistant] ${msg.content.slice(0, 200).replace(/\n/g, ' ')}`);
            } else if (msg.role === 'tool' && msg.content) {
                // Condense tool results to a single line
                const name = msg.name ?? 'tool';
                const preview = msg.content.slice(0, 100).replace(/\n/g, ' ');
                recapParts.push(`[Tool: ${name}] ${preview}...`);
            } else if (msg.role === 'user' && msg.content) {
                recapParts.push(`[User] ${msg.content.slice(0, 200).replace(/\n/g, ' ')}`);
            }
        }

        const recapMessage: Message = {
            role: 'user',
            content:
                `[CONTEXT RECAP — ${batchSize} older messages were summarized to save space]\n` +
                recapParts.join('\n'),
        };

        const result: Message[] = [];
        if (systemMsg) result.push(systemMsg);
        result.push(recapMessage, ...remaining);
        return result;
    }

    /**
     * Truncate a tool result string if it exceeds MAX_TOOL_RESULT_TOKENS.
     * Keeps the first and last portions with a truncation marker in between.
     */
    truncateToolResult(content: string, maxTokens?: number): string {
        const limit = maxTokens ?? MAX_TOOL_RESULT_TOKENS;
        const maxChars = Math.floor(limit * CHARS_PER_TOKEN);

        if (content.length <= maxChars) return content;

        // Keep 60% from the start, 30% from the end, 10% for the marker
        const headChars = Math.floor(maxChars * 0.6);
        const tailChars = Math.floor(maxChars * 0.3);
        const head = content.slice(0, headChars);
        const tail = content.slice(-tailChars);
        const truncatedChars = content.length - headChars - tailChars;

        return (
            head +
            `\n\n[... ${truncatedChars} characters truncated (${Math.ceil(truncatedChars / CHARS_PER_TOKEN)} est. tokens) ...]\n\n` +
            tail
        );
    }
}
