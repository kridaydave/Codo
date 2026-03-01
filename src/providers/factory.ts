import { CodoConfig } from '../config/config.js';
import { LLMProvider } from './types.js';
import { AnthropicProvider } from './anthropic.js';
import { GeminiProvider } from './gemini.js';
import { MoonshotProvider } from './moonshot.js';
import { OllamaProvider } from './ollama.js';
import { OpenCodeProvider } from './opencode.js';
import { GroqProvider } from './groq.js';
import { OpenRouterProvider } from './openrouter.js';

export function createProvider(config: CodoConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config.apiKey, config.model);
    case 'gemini':
    case 'google':
      return new GeminiProvider(config.apiKey, config.model);
    case 'moonshot':
      return new MoonshotProvider(config.apiKey, config.model);
    case 'ollama':
      return new OllamaProvider(config.model, config.ollamaBaseUrl ?? 'http://localhost:11434');
    case 'opencode':
      return new OpenCodeProvider(config.apiKey, config.model);
    case 'groq':
      return new GroqProvider(config.apiKey, config.model);
    case 'openrouter':
      return new OpenRouterProvider(config.apiKey, config.model);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
