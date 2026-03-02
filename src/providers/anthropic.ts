import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, Message, ToolInput, ToolCall } from './types.js';

const SUPPORTED_MODELS = ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'];

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  model: string;
  private client: Anthropic;

  constructor(apiKey: string, model: string) {
    if (!SUPPORTED_MODELS.includes(model)) {
      throw new Error(
        `Anthropic: Unsupported model '${model}'. Supported: ${SUPPORTED_MODELS.join(', ')}`,
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
