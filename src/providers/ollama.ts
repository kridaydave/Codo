import { LLMProvider, Message, ToolInput, ToolCall } from './types.js';

const SUPPORTED_MODELS = ['llama3', 'llama3.1', 'llama3.2', 'mistral', 'codellama', 'phi3'];

export class OllamaProvider implements LLMProvider {
  name = 'ollama';
  private model: string;
  private baseUrl: string;
  private initialized = false;

  constructor(model: string, baseUrl: string) {
    this.model = model;
    this.baseUrl = baseUrl;
  }

  private async verifyConnection(): Promise<void> {
    if (!SUPPORTED_MODELS.includes(this.model)) {
      throw new Error(
        `Ollama: Model '${this.model}' not supported. Supported models: ${SUPPORTED_MODELS.join(', ')}`,
      );
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      const availableModels = data.models?.map((m: { name: string }) => m.name.split(':')[0]) || [];
      const modelExists = availableModels.includes(this.model);

      if (!modelExists) {
        throw new Error(`Model '${this.model}' not found`);
      }
    } catch (error: any) {
      if (
        error.message === 'Connection refused' ||
        error.message.includes('ECONNREFUSED') ||
        error.cause?.code === 'ECONNREFUSED'
      ) {
        throw new Error('Ollama: Not running. Start it with: ollama serve');
      }
      if (error.message.includes('not found')) {
        throw new Error(
          `Ollama: Model '${this.model}' not found. Pull it with: ollama pull ${this.model}`,
        );
      }
      if (error.message.includes('not supported')) {
        throw error;
      }
      throw error;
    }
  }

  async sendMessage(
    messages: Message[],
    tools: ToolInput[],
  ): Promise<{ content: string; toolCalls?: ToolCall[]; usage?: any }> {
    if (!this.initialized) {
      await this.verifyConnection();
      this.initialized = true;
    }

    try {
      const payload: any = {
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
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

      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const message = data.message;
      const content = message?.content || '';

      let parsedToolCalls: ToolCall[] | undefined;
      if (message?.tool_calls && Array.isArray(message.tool_calls)) {
        parsedToolCalls = message.tool_calls
          .filter((tc: any) => tc.function)
          .map((tc: any) => {
            let input = {};
            if (typeof tc.function.arguments === 'string') {
              try {
                input = JSON.parse(tc.function.arguments);
              } catch (e) {
                console.error('Failed to parse tool call arguments:', e);
                input = { error: 'Failed to parse arguments' };
              }
            } else if (typeof tc.function.arguments === 'object') {
              input = tc.function.arguments;
            }
            return {
              name: tc.function.name,
              input,
            };
          });
      }

      const usage = {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      };

      return { content, toolCalls: parsedToolCalls, usage };
    } catch (error: any) {
      if (
        error.message === 'Connection refused' ||
        error.message.includes('ECONNREFUSED') ||
        error.cause?.code === 'ECONNREFUSED'
      ) {
        throw new Error('Ollama: Not running. Run: ollama serve');
      }
      throw new Error('Ollama: ' + error.message);
    }
  }
}
