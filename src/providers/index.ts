import { LLMProvider } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { GoogleProvider } from './google.js';
import { loadConfig } from '../config/config.js';
import { createProvider as createProviderFn } from './factory.js';

export type ProviderType = 'anthropic' | 'google' | 'openai' | 'moonshot' | 'ollama' | 'groq' | 'openrouter';

export async function createProvider(type?: ProviderType): Promise<LLMProvider> {
  const config = await loadConfig();

  if (type) {
    config.provider = type as any;
  }

  return createProviderFn(config);
}

export { AnthropicProvider } from './anthropic.js';
export { GoogleProvider } from './google.js';
export { GoogleProvider as GoogleGenerativeAIProvider } from './google.js';
export { GroqProvider } from './groq.js';
export { OpenRouterProvider } from './openrouter.js';
export type { LLMProvider, Message, ToolInput, ToolCall, ToolResult } from './types.js';
