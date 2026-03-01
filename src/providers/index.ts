import { LLMProvider } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { GoogleProvider } from './google.js';
import { loadConfig } from '../core/config.js';

export type ProviderType = 'anthropic' | 'google' | 'openai';

export async function createProvider(type?: ProviderType): Promise<LLMProvider> {
  const config = await loadConfig();
  const providerType = type || config.defaultProvider;

  switch (providerType) {
    case 'anthropic':
      return new AnthropicProvider();
    case 'google':
      return new GoogleProvider();
    case 'openai':
      throw new Error('OpenAI provider not yet implemented');
    default:
      throw new Error(`Unknown provider: ${providerType}`);
  }
}

export { AnthropicProvider } from './anthropic.js';
export { GoogleProvider } from './google.js';
export { GoogleProvider as GoogleGenerativeAIProvider } from './google.js';
export type { LLMProvider, Message, ToolInput, ToolCall, ToolResult } from './types.js';
