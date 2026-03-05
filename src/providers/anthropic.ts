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

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemMessages.map((m) => m.content) as any,
      messages: nonSystemMessages as any,
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
