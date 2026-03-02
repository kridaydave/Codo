import { LLMProvider, Message, ToolInput, ToolCall } from './types.js';

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  defaultModel: string;
}

export abstract class OpenAICompatibleProvider implements LLMProvider {
  name: string;
  model: string;
  protected apiKey: string;
  protected baseUrl: string;

  constructor(config: ProviderConfig) {
    this.name = config.name;
    this.model = config.model || config.defaultModel;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl;
  }

  abstract getSupportedModels(): string[];
  abstract validateModel(): void;

  async sendMessage(
    messages: Message[],
    tools: ToolInput[],
  ): Promise<{ content: string; toolCalls?: ToolCall[]; usage?: any }> {
    this.validateModel();

    const payload: any = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 8096,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema
        }
      }));
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 401) {
      throw new Error(`${this.name}: Invalid API key`);
    }
    if (response.status === 429) {
      throw new Error(`${this.name}: Rate limited`);
    }
    if (response.status === 400) {
      throw new Error(`${this.name}: Bad request`);
    }
    if (!response.ok) {
      throw new Error(`${this.name}: Request failed with status ${response.status}`);
    }

    const data = (await response.json()) as any;
    const message = data.choices[0]?.message;
    const content = message?.content ?? '';

    let parsedToolCalls: ToolCall[] | undefined;
    if (message?.tool_calls && Array.isArray(message.tool_calls)) {
      parsedToolCalls = message.tool_calls
        .filter((tc: any) => tc.type === 'function')
        .map((tc: any) => {
          let input = {};
          try {
            input = JSON.parse(tc.function.arguments);
          } catch (e) { }
          return {
            id: tc.id,
            name: tc.function.name,
            input
          };
        });
    }

    const usage = data.usage
      ? {
        promptTokens: data.usage.prompt_tokens || 0,
        completionTokens: data.usage.completion_tokens || 0,
        totalTokens: data.usage.total_tokens || 0,
      }
      : undefined;

    return { content, toolCalls: parsedToolCalls, usage };
  }
}
