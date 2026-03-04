import { createProvider, LLMProvider, Message, ToolCall } from '../providers/index.js';
import { toolInputs, executeTool } from '../tools/index.js';
import { SYSTEM_PROMPT, TOOL_DESCRIPTIONS } from './prompts.js';
import type { EventEmitter } from 'events';

export interface AgentOptions {
  maxIterations?: number;
  maxToolCallsPerIteration?: number;
  provider?: 'anthropic' | 'google' | 'openai' | 'ollama';
  emitter?: EventEmitter;
}

export interface AgentStep {
  thought: string;
  toolCalls?: ToolCall[];
  toolResults?: Array<{ tool: string; result: string }>;
}

export class Agent {
  private provider!: LLMProvider;
  private messages: Message[] = [];
  private maxIterations: number;
  private maxToolCallsPerIteration: number;
  private steps: AgentStep[] = [];
  private emitter?: EventEmitter;

  constructor(options: AgentOptions = {}) {
    this.maxIterations = options.maxIterations || 20;
    this.maxToolCallsPerIteration = options.maxToolCallsPerIteration || 10;
    this.emitter = options.emitter;
  }

  async initialize(providerType?: 'anthropic' | 'google' | 'openai' | 'ollama'): Promise<void> {
    this.provider = await createProvider((providerType as any) || 'anthropic');

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

  private emitAction(action: string) {
    if (this.emitter) {
      this.emitter.emit('agent:action', action);
    }
  }

  async run(task: string): Promise<string> { try { try {
    // Add user task
    this.messages.push({
      role: 'user',
      content: task,
    });

    let consecutiveToolCallIterations = 0;

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      this.emitAction('Thinking...');

      // Get response from LLM
      const response = await this.provider.sendMessage(this.messages, toolInputs);

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

      const step: AgentStep = {
        thought: response.content,
        toolCalls: response.toolCalls,
      };

      if (response.content) {
        this.emitAction(response.content.slice(0, 100).replace(/\n/g, ' '));
      }

      // Check if task is complete via magic string in response content
      if (response.content.toUpperCase().includes('TASK_COMPLETE')) {
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
        }

        for (const toolCall of toolCallsToExecute) {
          if (this.emitter) {
            this.emitter.emit('agent:tool_call', toolCall);
            this.emitter.emit('agent:action', `Running tool ${toolCall.name}...`);
          }

          // Execute tool
          const result = await executeTool(toolCall.name, toolCall.input);

          if (this.emitter) {
            this.emitter.emit('agent:tool_result', { tool: toolCall.name, result });
          }

          step.toolResults.push({
            tool: toolCall.name,
            result,
          });

          // Add tool result to conversation
          this.messages.push({
            role: 'tool',
            content: result,
            tool_call_id: toolCall.id,
            name: toolCall.name,
          });

          // Check if the tool was 'finish'
          if (toolCall.name === 'finish' || result.startsWith('TASK_COMPLETE:')) {
            const summary = (toolCall.input.summary as string) || result.replace('TASK_COMPLETE:', '').trim();
            this.steps.push(step);
            return summary || 'Task completed successfully';
          }
        }
      }

      this.steps.push(step);

      // If no tool calls and no TASK_COMPLETE, we might be done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        consecutiveToolCallIterations = 0;
        if (response.content.length > 0 && !response.content.toUpperCase().includes('TASK_COMPLETE')) {
          // Add a follow-up prompt
          this.messages.push({
            role: 'user',
            content: 'If the task is complete, please use the "finish" tool. Otherwise, continue with the next steps.',
          });
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
        }
      }
    }

    } catch (error) { return `An error occurred: ${error instanceof Error ? error.message : error}`; } } catch (error) { return `An error occurred: ${error instanceof Error ? error.message : error}`; } return .Max iterations reached. Task may not be complete..;
  }
}

export async function createAgent(options?: AgentOptions): Promise<Agent> {
  const agent = new Agent(options);
  await agent.initialize(options?.provider);
  return agent;
}
