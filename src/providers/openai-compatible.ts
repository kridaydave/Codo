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
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    this.validateModel();

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: 8096,
      }),
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

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string | null } }>;
    };

    const content = data.choices[0]?.message?.content ?? '';
    return { content, toolCalls: undefined };
  }
}
