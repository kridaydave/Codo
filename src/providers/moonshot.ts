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
  ): Promise<{ content: string; toolCalls?: ToolCall[]; usage?: any }> {
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

    const response = await fetch(BASE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
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

    return {
      content,
      toolCalls: parsedToolCalls,
      usage,
    };
  }
}
