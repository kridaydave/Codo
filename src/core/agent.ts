import {
  createProvider,
  type ProviderType,
  LLMProvider,
  Message,
  ToolCall,
} from '../providers/index.js';
import { toolInputs, executeTool } from '../tools/index.js';
import { SYSTEM_PROMPT, TOOL_DESCRIPTIONS } from './prompts.js';
import { ContextManager } from './context-manager.js';
import type { EventEmitter } from 'events';

export interface AgentOptions {
  maxIterations?: number;
  maxToolCallsPerIteration?: number;
  maxMessages?: number;
  provider?: ProviderType;
  emitter?: EventEmitter;
  worktreeDir?: string; // isolates file ops to this directory
}

export interface AgentStep {
  thought: string;
  toolCalls?: ToolCall[];
  toolResults?: Array<{ tool: string; result: string }>;
}

export interface AgentError {
  message: string;
  type: 'network' | 'api' | 'rate_limit' | 'bad_request' | 'unknown';
  retryable: boolean;
  originalError?: Error;
}

const MAX_RETRIES = 3;
const RETRY_DELAY_BASE = 1000;
const TOOL_CALL_DELAY_MS = 1500; // Delay between tool calls to avoid rate limiting
const API_CALL_DELAY_MS = 1000; // Delay between API calls to avoid rate limiting

function classifyError(error: unknown): AgentError {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  if (
    lowerMessage.includes('network') ||
    lowerMessage.includes('fetch') ||
    lowerMessage.includes('connect') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('econnrefused') ||
    lowerMessage.includes('enotfound') ||
    lowerMessage.includes('socket')
  ) {
    return {
      message: `Network error: ${message}`,
      type: 'network',
      retryable: true,
      originalError: error instanceof Error ? error : undefined,
    };
  }

  if (
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('too many requests') ||
    lowerMessage.includes('429') ||
    lowerMessage.includes('rate_limit')
  ) {
    return {
      message: `Rate limit exceeded. Please wait before retrying.`,
      type: 'rate_limit',
      retryable: true,
      originalError: error instanceof Error ? error : undefined,
    };
  }

  if (
    lowerMessage.includes('400') ||
    lowerMessage.includes('bad request') ||
    lowerMessage.includes('invalid request') ||
    lowerMessage.includes('malformed')
  ) {
    return {
      message: `Bad request: ${message}`,
      type: 'bad_request',
      retryable: true,
      originalError: error instanceof Error ? error : undefined,
    };
  }

  if (
    lowerMessage.includes('401') ||
    lowerMessage.includes('403') ||
    lowerMessage.includes('authentication') ||
    lowerMessage.includes('api key') ||
    lowerMessage.includes('unauthorized') ||
    lowerMessage.includes('invalid')
  ) {
    return {
      message: `API authentication error: ${message}`,
      type: 'api',
      retryable: false,
      originalError: error instanceof Error ? error : undefined,
    };
  }

  if (
    lowerMessage.includes('500') ||
    lowerMessage.includes('502') ||
    lowerMessage.includes('503') ||
    lowerMessage.includes('504') ||
    lowerMessage.includes('internal server error') ||
    lowerMessage.includes('bad gateway') ||
    lowerMessage.includes('service unavailable') ||
    lowerMessage.includes('gateway timeout')
  ) {
    return {
      message: `Provider server error: ${message}`,
      type: 'api',
      retryable: true,
      originalError: error instanceof Error ? error : undefined,
    };
  }

  return {
    message: `API error: ${message}`,
    type: 'api',
    retryable: false,
    originalError: error instanceof Error ? error : undefined,
  };
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendMessageWithRetry(
  provider: LLMProvider,
  messages: Message[],
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[],
  attempt: number = 1,
): Promise<{
  content: string;
  toolCalls?: ToolCall[];
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}> {
  try {
    return await provider.sendMessage(messages, tools);
  } catch (error) {
    const agentError = classifyError(error);

    if (!agentError.retryable || attempt >= MAX_RETRIES) {
      throw agentError;
    }

    const delayMs = RETRY_DELAY_BASE * Math.pow(2, attempt - 1);
    await delay(delayMs);

    return sendMessageWithRetry(provider, messages, tools, attempt + 1);
  }
}

export class Agent {
  private provider!: LLMProvider;
  private messages: Message[] = [];
  private maxIterations: number;
  private maxToolCallsPerIteration: number;
  private maxMessages: number;
  private steps: AgentStep[] = [];
  private emitter?: EventEmitter;
  private worktreeDir?: string;
  private contextManager!: ContextManager;
  private providerType?: ProviderType;

  constructor(options: AgentOptions = {}) {
    this.maxIterations = options.maxIterations || 20;
    this.maxToolCallsPerIteration = options.maxToolCallsPerIteration || 10;
    this.maxMessages = options.maxMessages || 100;
    this.emitter = options.emitter;
    this.worktreeDir = options.worktreeDir;
    this.providerType = options.provider;
  }

  /** Set the worktree directory for tool isolation. Used by the orchestrator. */
  setWorktreeDir(dir: string): void {
    this.worktreeDir = dir;
  }

  async initialize(providerType?: ProviderType): Promise<void> {
    const resolvedProvider = providerType || this.providerType || 'anthropic';
    this.provider = await createProvider(resolvedProvider);
    this.contextManager = new ContextManager(resolvedProvider);

    // Initialize with system prompt
    this.messages = [
      {
        role: 'system',
        content: `${SYSTEM_PROMPT}\n\n${TOOL_DESCRIPTIONS}`,
      },
    ];
  }

  getSteps(): AgentStep[] {
    return this.steps;
  }

  /** Return the current conversation messages for checkpoint serialization. */
  getMessages(): Message[] {
    return this.messages;
  }

  /** Reset the agent's memory for a new task. */
  reset(): void {
    this.messages = [
      {
        role: 'system',
        content: `${SYSTEM_PROMPT}\n\n${TOOL_DESCRIPTIONS}`,
      },
    ];
    this.steps = [];
  }

  private emitAction(action: string) {
    if (this.emitter) {
      this.emitter.emit('agent:action', action);
    }
  }

  private trimMessages(): void {
    if (this.messages.length > this.maxMessages) {
      const systemMessage = this.messages[0];
      if (systemMessage && systemMessage.role === 'system') {
        const nonSystemMessages = this.messages.slice(1);
        const keepCount = this.maxMessages - 1;
        const keptMessages = nonSystemMessages.slice(-keepCount);
        this.messages = [systemMessage, ...keptMessages];
      } else {
        this.messages = this.messages.slice(-this.maxMessages);
      }
    }
  }

  async run(task: string, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) {
      throw new DOMException('Task aborted', 'AbortError');
    }

    const checkAbort = () => {
      if (signal?.aborted) {
        throw new DOMException('Task aborted', 'AbortError');
      }
    };

    signal?.addEventListener('abort', () => {
      throw new DOMException('Task aborted', 'AbortError');
    });

    // Add user task
    this.messages.push({
      role: 'user',
      content: task,
    });
    this.trimMessages();

    let consecutiveToolCallIterations = 0;

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      checkAbort();

      // Proactive context trimming — summarize old messages before they cause a 400
      if (this.contextManager.shouldTrim(this.messages)) {
        const ratio = this.contextManager.getUsageRatio(this.messages);
        this.emitAction(`Context at ${Math.round(ratio * 100)}% — summarizing older messages...`);
        this.messages = this.contextManager.summarizeOldest(this.messages);
      }

      this.emitAction('Thinking...');

      let response: {
        content: string;
        toolCalls?: ToolCall[];
        usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
      };

      try {
        response = await sendMessageWithRetry(this.provider, this.messages, toolInputs);
      } catch (error) {
        const agentError = error as AgentError;
        const errorMessage = agentError.message || 'Unknown error occurred';

        this.emitAction(`Error: ${errorMessage}`);

        if (agentError.type === 'network') {
          return `Failed to connect to the LLM provider after multiple attempts. Please check your network connection and try again. Error: ${errorMessage}`;
        }

        if (agentError.type === 'rate_limit') {
          return `Rate limit exceeded. Please wait a moment before running another task. Error: ${errorMessage}`;
        }

        if (agentError.type === 'bad_request') {
          // Recover: trim the last few messages that likely caused the 400,
          // inject a recovery prompt, and continue the loop.
          this.emitAction(`Recovering from bad request: ${errorMessage}`);
          const systemMsg = this.messages[0];
          const nonSystem = this.messages.slice(1);
          const trimCount = Math.min(2, nonSystem.length);
          this.messages = systemMsg
            ? [systemMsg, ...nonSystem.slice(0, -trimCount)]
            : nonSystem.slice(0, -trimCount);
          this.messages.push({
            role: 'user',
            content:
              `[SYSTEM] The previous API call failed with: ${errorMessage}. ` +
              `Some recent context was removed to recover. Please re-assess the current task state and continue from where you left off.`,
          });
          this.trimMessages();
          continue;
        }

        if (agentError.type === 'api') {
          if (!agentError.retryable) {
            return `API error: ${errorMessage}`;
          }
          return `Provider temporarily unavailable. Please try again later. Error: ${errorMessage}`;
        }

        return `Unexpected error: ${errorMessage}`;
      }

      checkAbort();

      // Emit usage if available
      if (response.usage && this.emitter) {
        this.emitter.emit('agent:usage', response.usage);
      }

      // Add assistant message to conversation
      this.messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls: response.toolCalls,
      });
      this.trimMessages();

      const step: AgentStep = {
        thought: response.content,
        toolCalls: response.toolCalls,
      };

      if (response.content) {
        this.emitAction(response.content.slice(0, 100).replace(/\n/g, ' '));
      }

      // Check if task is complete via magic string in response content
      if (response.content?.toUpperCase().includes('TASK_COMPLETE')) {
        const summary = response.content.replace(/TASK_COMPLETE/gi, '').trim();
        step.thought = summary;
        this.steps.push(step);
        return summary || 'Task completed successfully';
      }

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        const toolCallsToExecute = response.toolCalls.slice(0, this.maxToolCallsPerIteration);
        step.toolResults = [];

        if (response.toolCalls.length > this.maxToolCallsPerIteration) {
          this.messages.push({
            role: 'user',
            content: `You have attempted to call ${response.toolCalls.length} tools, but only the first ${this.maxToolCallsPerIteration} will be executed. Please complete the task with these tools or let me know if you need help.`,
          });
          this.trimMessages();
        }

        for (const toolCall of toolCallsToExecute) {
          checkAbort();
          if (this.emitter) {
            this.emitter.emit('agent:tool_call', toolCall);
            this.emitter.emit('agent:action', `Running tool ${toolCall.name}...`);
          }

          let result: string;
          try {
            result = await executeTool(toolCall.name, toolCall.input, this.worktreeDir);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorType = error instanceof Error ? error.constructor.name : 'UnknownError';

            let userFriendlyMessage = `Tool execution failed: ${errorMessage}`;
            if (errorType === 'ENOENT' || errorType === 'FileNotFoundError') {
              userFriendlyMessage = `Tool execution failed: File or directory not found. ${errorMessage}`;
            } else if (errorType === 'PermissionError' || errorType === 'EPERM') {
              userFriendlyMessage = `Tool execution failed: Permission denied. ${errorMessage}`;
            } else if (errorType === 'ValidationError') {
              userFriendlyMessage = `Tool execution failed: Invalid input. ${errorMessage}`;
            } else if (errorType === 'TimeoutError' || errorType === 'ETIMEDOUT') {
              userFriendlyMessage = `Tool execution failed: Operation timed out. ${errorMessage}`;
            }

            result = `ERROR: ${userFriendlyMessage}`;

            if (this.emitter) {
              this.emitter.emit('agent:tool_error', {
                tool: toolCall.name,
                error: userFriendlyMessage,
              });
            }
          }

          if (this.emitter) {
            this.emitter.emit('agent:tool_result', { tool: toolCall.name, result });
          }

          step.toolResults.push({
            tool: toolCall.name,
            result,
          });

          // Truncate large tool results to prevent context overflow
          const trimmedResult = this.contextManager.truncateToolResult(result);

          // Add tool result to conversation
          this.messages.push({
            role: 'tool',
            content: trimmedResult,
            tool_call_id: toolCall.id,
            name: toolCall.name,
          });
          this.trimMessages();

          // Delay between tool calls to avoid rate limiting
          if (toolCallsToExecute.length > 1) {
            await delay(TOOL_CALL_DELAY_MS);
          }

          // Check if the tool was 'finish'
          if (toolCall.name === 'finish') {
            const inputSummary = toolCall.input?.summary;
            const summary =
              typeof inputSummary === 'string'
                ? inputSummary
                : result.replace('TASK_COMPLETE:', '').trim();
            this.steps.push(step);
            return summary || 'Task completed successfully';
          }
        }
      }

      this.steps.push(step);

      // If no tool calls and no TASK_COMPLETE, we might be done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        consecutiveToolCallIterations = 0;
        if (
          response.content?.length > 0 &&
          !response.content?.toUpperCase().includes('TASK_COMPLETE')
        ) {
          // Add a follow-up prompt
          this.messages.push({
            role: 'user',
            content:
              'If the task is complete, please use the "finish" tool. Otherwise, continue with the next steps.',
          });
          this.trimMessages();
        }
      } else {
        consecutiveToolCallIterations++;
        // After 3 consecutive iterations with tool calls, ask for confirmation
        if (consecutiveToolCallIterations >= 3) {
          consecutiveToolCallIterations = 0;
          this.messages.push({
            role: 'user',
            content:
              'You have made multiple tool calls without completing the task. Please either complete the task now or explain what you are stuck on.',
          });
          this.trimMessages();
        }
      }

      // Small delay between iterations to avoid rate limiting
      if (iteration < this.maxIterations - 1) {
        await delay(API_CALL_DELAY_MS);
      }
    }

    return 'Max iterations reached. Task may not be complete.';
  }
}

export async function createAgent(options?: AgentOptions): Promise<Agent> {
  const agent = new Agent(options);
  await agent.initialize(options?.provider);
  return agent;
}
