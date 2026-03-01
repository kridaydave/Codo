import { LLMProvider, Message, ToolInput, ToolCall } from './types.js';

const SUPPORTED_MODELS = ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'];
const BASE_URL = 'https://api.moonshot.cn/v1/chat/completions';

export class MoonshotProvider implements LLMProvider {
  name = 'moonshot';
  model: string;
  private apiKey: string;

  constructor(apiKey: string, model: string) {
    if (!SUPPORTED_MODELS.includes(model)) {
      throw new Error(
        `Moonshot: Unsupported model '${model}'. Supported: ${SUPPORTED_MODELS.join(', ')}`,
      );
    }
    this.model = model;
    this.apiKey = apiKey;
  }

  async sendMessage(
    messages: Message[],
    tools: ToolInput[],
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    const response = await fetch(BASE_URL, {
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
      throw new Error('Moonshot: Invalid API key');
    }
    if (response.status === 429) {
      throw new Error('Moonshot: Rate limited');
    }
    if (response.status === 400) {
      throw new Error('Moonshot: Bad request');
    }
    if (!response.ok) {
      throw new Error(`Moonshot: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices[0]?.message?.content ?? '';

    return {
      content,
      toolCalls: undefined,
    };
  }
}
