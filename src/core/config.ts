import { readFile } from 'fs/promises';
import { join } from 'path';

export interface ProviderConfig {
  apiKey: string;
  enabled: boolean;
}

export interface Config {
  providers: {
    anthropic?: ProviderConfig;
    openai?: ProviderConfig;
    google?: ProviderConfig;
  };
  defaultProvider: 'anthropic' | 'openai' | 'google';
}

let cachedConfig: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configPath = join(process.cwd(), '.codo', 'config.json');
  
  try {
    const content = await readFile(configPath, 'utf-8');
    cachedConfig = JSON.parse(content) as Config;
    return cachedConfig!;
  } catch (error) {
    throw new Error(`Failed to load config from ${configPath}: ${error}`);
  }
}

export function getApiKey(provider: keyof Config['providers']): string {
  if (!cachedConfig) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  
  const providerConfig = cachedConfig.providers[provider];
  if (!providerConfig) {
    throw new Error(`Provider ${provider} not configured`);
  }
  
  if (!providerConfig.enabled) {
    throw new Error(`Provider ${provider} is not enabled`);
  }
  
  if (!providerConfig.apiKey) {
    throw new Error(`API key not set for ${provider}`);
  }
  
  return providerConfig.apiKey;
}
