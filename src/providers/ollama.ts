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
  ): Promise<{ content: string; toolCalls?: ToolCall[] }> {
    if (!this.initialized) {
      await this.verifyConnection();
      this.initialized = true;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const content = data.message?.content || '';

      return { content, toolCalls: undefined };
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
