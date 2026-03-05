import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, Message, ToolInput, ToolCall } from './types.js';

const SUPPORTED_MODEL_PREFIXES = [
  'claude-opus',
  'claude-sonnet',
  'claude-haiku',
  'claude-3-5-sonnet',
  'claude-3-opus',
  'claude-3-sonnet',
  'claude-3-haiku',
];

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  model: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string) {
    const isSupported = SUPPORTED_MODEL_PREFIXES.some((prefix) => model.startsWith(prefix));
    if (!isSupported) {
      console.warn(
        `Anthropic: Model '${model}' may not be supported. Known prefixes: ${SUPPORTED_MODEL_PREFIXES.join(', ')}`,
      );
    }
    this.model = model;
    this.client = new Anthropic({ apiKey });
  }

  async sendMessage(
    messages: Message[],
    tools: ToolInput[],
  ): Promise<{ content: string; toolCalls?: ToolCall[]; usage?: any }> {
    const systemMessages = messages.filter((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    // Map messages to Anthropic format
    const mappedMessages: any[] = [];
    for (const msg of nonSystemMessages) {
      if (msg.role === 'user') {
        mappedMessages.push({ role: 'user', content: msg.content });
      } else if (msg.role === 'assistant') {
        const content: any[] = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            content.push({
              type: 'tool_use',
              id: tc.id,
              name: tc.name,
              input: tc.input,
            });
          }
        }
        mappedMessages.push({ role: 'assistant', content });
      } else if (msg.role === 'tool') {
        // Anthropic expects tool results as role: 'user' with a tool_result block
        // Multiple tool results from the same turn MUST be in the same message.
        const lastMsg = mappedMessages[mappedMessages.length - 1];
        if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content) && lastMsg.content[0]?.type === 'tool_result') {
          lastMsg.content.push({
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: msg.content,
          });
        } else {
          mappedMessages.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: msg.tool_call_id,
                content: msg.content,
              },
            ],
          });
        }
      }
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemMessages.map((m) => m.content) as any,
      messages: mappedMessages as any,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      })) as any,
    });

    const contentBlocks = response.content;
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of contentBlocks) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    const usage = {
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    };

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    };
  }
}
