import Anthropic from '@anthropic-ai/sdk';
import { LLMProvider, Message, ToolInput, ToolCall } from './types.js';
import { getApiKey } from '../core/config.js';

export class AnthropicProvider implements LLMProvider {
  name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || getApiKey('anthropic'),
    });
  }

  async sendMessage(
    messages: Message[],
    tools: ToolInput[]
  ): Promise<{
    content: string;
    toolCalls?: ToolCall[];
  }> {
    const anthropicTools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema,
    }));

    const response = await this.client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: messages as any,
      tools: anthropicTools as any,
    });

    const contentBlocks = response.content;
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of contentBlocks) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }
}
