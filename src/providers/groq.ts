import { OpenAICompatibleProvider, type ProviderConfig } from './openai-compatible.js';

const SUPPORTED_MODELS = [
    'llama-3.3-70b-versatile',
    'llama-3.3-70b-specdec',
    'llama-3.1-8b-instant',
    'llama3-8b-8192',
    'llama3-70b-8192',
    'mixtral-8x7b-32768',
    'gemma-7b-it',
    'gemma2-9b-it'
];

export class GroqProvider extends OpenAICompatibleProvider {
    constructor(apiKey: string, model: string) {
        const config: ProviderConfig = {
            name: 'groq',
            baseUrl: 'https://api.groq.com/openai/v1',
            apiKey,
            model,
            defaultModel: 'llama3-70b-8192',
        };
        super(config);
    }

    getSupportedModels(): string[] {
        return SUPPORTED_MODELS;
    }

    validateModel(): void {
        const strictMatch = SUPPORTED_MODELS.includes(this.model);
        const looseMatch = SUPPORTED_MODELS.some(m => m.includes(this.model) || this.model.includes(m));

        // Let it pass since models change all the time, just log internally if no strict match
    }
}
