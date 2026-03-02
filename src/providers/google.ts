import { GoogleGenerativeAI, Schema, SchemaType } from '@google/generative-ai';
import { LLMProvider, Message, ToolInput, ToolCall } from './types.js';
import { getApiKey } from '../core/config.js';

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (error.message?.includes('429') || error.message?.includes('rate limit') || error.message?.includes(' quota')) {
        const delay = Math.pow(2, i) * 2000;
        console.log(`Rate limited, retrying in ${delay/1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}

function convertToGoogleSchema(inputSchema: Record<string, unknown>): any {
  const properties: Record<string, any> = {};
  
  if (inputSchema.properties && typeof inputSchema.properties === 'object') {
    const props = inputSchema.properties as Record<string, any>;
    for (const [key, prop] of Object.entries(props)) {
      properties[key] = {
        type: prop.type || 'string',
        description: prop.description || '',
      };
    }
  }

  return {
    type: 'object',
    properties,
    required: inputSchema.required || [],
  };
}

export class GoogleProvider implements LLMProvider {
  name = 'google';
  private client: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    this.client = new GoogleGenerativeAI(apiKey || getApiKey('google'));
  }

  async sendMessage(
    messages: Message[],
    tools: ToolInput[]
  ): Promise<{
    content: string;
    toolCalls?: ToolCall[];
    usage?: any;
  }> {
    const model = this.client.getGenerativeModel({
      model: 'gemini-2.5-flash',
      tools: tools.map((tool) => ({
        functionDeclarations: [
          {
            name: tool.name,
            description: tool.description,
            parameters: convertToGoogleSchema(tool.input_schema) as unknown as {
              type: SchemaType;
              properties: Record<string, Schema>;
              required?: string[];
            },
          },
        ],
      })),
    });

    // Extract system message and combine with first user message
    let systemPrompt = '';
    const filteredMessages = messages.filter((msg) => {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
        return false;
      }
      return true;
    });

    const contents: { role: string; parts: { text: string }[] }[] = [];
    
    for (const msg of filteredMessages) {
      const text = msg.content;
      
      if (contents.length === 0 && systemPrompt) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: `${systemPrompt}\n\n${text}` }],
        });
      } else {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text }],
        });
      }
    }

    const result = await withRetry(() => model.generateContent({
      contents,
    }));

    const response = result.response;
    const candidates = response.candidates;

    if (!candidates || candidates.length === 0) {
      return { content: '' };
    }

    const parts = candidates[0].content.parts;
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        textContent += part.text;
      } else if (part.functionCall) {
        const func = part.functionCall;
        toolCalls.push({
          name: func.name,
          input: func.args as Record<string, unknown>,
        });
      }
    }

    const usage = response.usageMetadata
      ? {
          promptTokens: response.usageMetadata.promptTokenCount || 0,
          completionTokens: response.usageMetadata.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata.totalTokenCount || 0,
        }
      : undefined;

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    };
  }
}
