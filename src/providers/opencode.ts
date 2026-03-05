import { OpenAICompatibleProvider, type ProviderConfig } from './openai-compatible.js';

const SUPPORTED_MODELS = [
  'opencode/gpt-5.3-codex',
  'opencode/gpt-5.2',
  'opencode/claude-3.5-haiku',
  'opencode/claude-3.5-sonnet',
  'opencode/gemini-2.5-flash',
  'opencode/gemini-2.5-pro',
  'opencode/gemini-2.0-flash',
  'opencode/gemini-1.5-flash',
  'minimax-m2.5',
  'minimax-m2.1',
  'glm-5',
  'kimi-k2.5',
];

export class OpenCodeProvider extends OpenAICompatibleProvider {
  constructor(apiKey: string, model: string) {
    const config: ProviderConfig = {
      name: 'opencode',
      baseUrl: 'https://opencode.ai/zen/v1',
      apiKey,
      model,
      defaultModel: 'minimax-m2.5',
    };
    super(config);
  }

  getSupportedModels(): string[] {
    return SUPPORTED_MODELS;
  }

  validateModel(): void {
    if (!SUPPORTED_MODELS.includes(this.model)) {
      throw new Error(
        `OpenCode: Unsupported model '${this.model}'. Supported: ${SUPPORTED_MODELS.join(', ')}`,
      );
    }
  }

  async sendMessage(
    messages: import('./types.js').Message[],
    tools: import('./types.js').ToolInput[],
  ): Promise<{ content: string; toolCalls?: import('./types.js').ToolCall[]; usage?: any }> {
    this.validateModel();

    const payload: any = {
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 8096,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    // Standard openai-compatible fetch, but using Token auth instead of Bearer
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Token ${this.apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 401) {
      const errText = await response.text();
      throw new Error(`${this.name}: Invalid API key. Server responded: ${errText}`);
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

    let parsedToolCalls: import('./types.js').ToolCall[] | undefined;
    if (message?.tool_calls && Array.isArray(message.tool_calls)) {
      parsedToolCalls = message.tool_calls
        .filter((tc: any) => tc.type === 'function')
        .map((tc: any) => {
          let input;
          try {
            input = JSON.parse(tc.function.arguments);
          } catch (e) {
            console.error('Failed to parse tool call arguments:', e);
            input = { error: 'Failed to parse arguments' };
          }
          return {
            id: tc.id,
            name: tc.function.name,
            input,
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
