import { OpenAICompatibleProvider, type ProviderConfig } from './openai-compatible.js';

export class OpenRouterProvider extends OpenAICompatibleProvider {
    constructor(apiKey: string, model: string) {
        const config: ProviderConfig = {
            name: 'openrouter',
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey,
            model,
            defaultModel: 'anthropic/claude-3.5-sonnet',
        };
        super(config);
    }

    getSupportedModels(): string[] {
        // OpenRouter has hundreds of models. We don't restrict this strictly.
        return ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-pro-1.5'];
    }

    validateModel(): void {
        // Allow any model string to pass through for OpenRouter
    }
}
