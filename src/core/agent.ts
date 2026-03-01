import { createProvider, LLMProvider, Message, ToolCall } from '../providers/index.js';
import { toolInputs, executeTool } from '../tools/index.js';
import { SYSTEM_PROMPT, TOOL_DESCRIPTIONS } from './prompts.js';
import type { EventEmitter } from 'events';

export interface AgentOptions {
  maxIterations?: number;
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
  private steps: AgentStep[] = [];
  private emitter?: EventEmitter;

  constructor(options: AgentOptions = {}) {
    this.maxIterations = options.maxIterations || 50;
    this.emitter = options.emitter;
  }

  async initialize(providerType?: 'anthropic' | 'google' | 'openai' | 'ollama'): Promise<void> {
    this.provider = await createProvider(providerType as any || 'anthropic');

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

  async run(task: string): Promise<string> {
    // Add user task
    this.messages.push({
      role: 'user',
      content: task,
    });

    for (let iteration = 0; iteration < this.maxIterations; iteration++) {
      this.emitAction('Thinking...');

      // Get response from LLM
      const response = await this.provider.sendMessage(this.messages, toolInputs);

      // Add assistant message to conversation
      this.messages.push({
        role: 'assistant',
        content: response.content,
      });

      const step: AgentStep = {
        thought: response.content,
      };

      if (response.content) {
        this.emitAction(response.content.slice(0, 100).replace(/\n/g, ' '));
      }

      // Check if task is complete
      if (response.content.includes('TASK_COMPLETE')) {
        const summary = response.content.replace('TASK_COMPLETE', '').trim();
        step.thought = summary;
        this.steps.push(step);
        return summary || 'Task completed successfully';
      }

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        step.toolCalls = response.toolCalls;
        step.toolResults = [];

        for (const toolCall of response.toolCalls) {
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
            role: 'user',
            content: `Tool ${toolCall.name} result: ${result}`,
          });
        }
      }

      this.steps.push(step);

      // If no tool calls and no TASK_COMPLETE, we might be done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        if (response.content.length > 0 && !response.content.includes('TASK_COMPLETE')) {
          // Add a follow-up prompt
          this.messages.push({
            role: 'user',
            content: 'Please continue or let me know if the task is complete.',
          });
        }
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
