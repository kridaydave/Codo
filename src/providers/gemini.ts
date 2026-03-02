import { LLMProvider, Message, ToolInput, ToolCall } from './types.js';

const SUPPORTED_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiProvider implements LLMProvider {
  name: string;
  model: string;
  private apiKey: string;

  constructor(apiKey: string, model: string) {
    if (!SUPPORTED_MODELS.includes(model)) {
      throw new Error(`Invalid model: ${model}. Supported models: ${SUPPORTED_MODELS.join(', ')}`);
    }
    this.name = 'gemini';
    this.model = model;
    this.apiKey = apiKey;
  }

  async sendMessage(
    messages: Message[],
    tools: ToolInput[],
  ): Promise<{ content: string; toolCalls?: ToolCall[]; usage?: any }> {
    const mappedMessages = this.mapMessages(messages);

    const body: Record<string, unknown> = {
      contents: mappedMessages,
    };

    if (tools.length > 0) {
      body.tools = tools.map((tool) => ({
        functionDeclarations: [
          {
            name: tool.name,
            description: tool.description,
            parameters: {
              type: 'object',
              properties: tool.input_schema.properties || {},
              required: tool.input_schema.required || [],
            },
          },
        ],
      }));
    }

    let lastError: Error | null = null;
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(
          `${BASE_URL}/models/${this.model}:generateContent?key=${this.apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(body),
          },
        );

        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000;
          console.log(`◎ Rate limited, retrying in ${waitTime / 1000}s...`);
          if (attempt < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, waitTime));
            continue;
          } else {
            throw new Error('Gemini: Rate limit exceeded after 3 retries');
          }
        }

        if (response.status === 400) {
          throw new Error('Gemini: Bad request - check your message format');
        }

        if (response.status === 401) {
          throw new Error('Gemini: Invalid API key');
        }

        if (response.status === 403) {
          throw new Error(`Gemini: API key doesn't have access to ${this.model}`);
        }

        if (response.status >= 500) {
          throw new Error('Gemini: Server error, try again');
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Gemini: Request failed with status ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        let content = '';
        const toolCalls: ToolCall[] = [];

        for (const part of parts) {
          if (part.text) {
            content += part.text;
          } else if (part.functionCall) {
            toolCalls.push({
              name: part.functionCall.name,
              input: part.functionCall.args || {},
            });
          }
        }

        const usage = data.usageMetadata
          ? {
            promptTokens: data.usageMetadata.promptTokenCount || 0,
            completionTokens: data.usageMetadata.candidatesTokenCount || 0,
            totalTokens: data.usageMetadata.totalTokenCount || 0,
          }
          : undefined;

        return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined, usage };
      } catch (error) {
        if (error instanceof Error) {
          if (error.message.includes('Rate limit') || error.message.includes('429')) {
            lastError = error;
            continue;
          }
          throw error;
        }
        throw error;
      }
    }

    throw lastError || new Error('Gemini: Request failed after retries');
  }

  private mapMessages(
    messages: Message[],
  ): Array<{ role: string; parts: Array<{ text: string }> }> {
    const mapped: Array<{ role: string; parts: Array<{ text: string }> }> = [];
    let systemMessage = '';

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessage += (systemMessage ? '\n' : '') + msg.content;
      } else if (msg.role === 'user') {
        mapped.push({
          role: 'user',
          parts: [{ text: msg.content }],
        });
      } else if (msg.role === 'assistant') {
        mapped.push({
          role: 'model',
          parts: [{ text: msg.content }],
        });
      }
    }

    if (systemMessage) {
      mapped.unshift({
        role: 'user',
        parts: [{ text: `System: ${systemMessage}` }],
      });
    }

    return mapped;
  }
}
