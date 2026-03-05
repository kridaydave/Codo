import { promises as fs } from 'fs';
import { join } from 'path';

export type ProviderType =
  | 'anthropic'
  | 'google'
  | 'gemini'
  | 'openai'
  | 'moonshot'
  | 'ollama'
  | 'groq'
  | 'openrouter'
  | 'opencode';

export interface CodoConfig {
  provider: ProviderType;
  apiKey: string;
  model: string;
  maxAgents: number;
  ollamaBaseUrl?: string;
}

const DEFAULT_CONFIG: CodoConfig = {
  provider: 'gemini',
  apiKey: 'your-api-key-here',
  model: 'gemini-2.5-flash',
  maxAgents: 5,
};

const PROVIDER_DEFAULTS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-6',
  gemini: 'gemini-2.5-flash',
  google: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  moonshot: 'moonshot-v1-8k',
  ollama: 'llama3',
  opencode: 'minimax-m2.5',
  groq: 'llama3-70b-8192',
  openrouter: 'anthropic/claude-3.5-sonnet',
};

let cachedConfig: CodoConfig | null = null;

const DEFAULT_CONFIG_CONTENT = JSON.stringify(
  {
    provider: 'gemini',
    apiKey: 'YOUR_API_KEY_HERE',
    model: 'gemini-2.5-flash',
    maxAgents: 5,
  },
  null,
  2,
);

export async function loadConfig(): Promise<CodoConfig> {
  const configDir = join(process.cwd(), '.codo');
  const configPath = join(configDir, 'config.json');

  let fileContent = '';
  try {
    fileContent = await fs.readFile(configPath, 'utf-8');
  } catch (err) {
    // Config file doesn't exist - create default
    console.log('\x1b[33m⚠ No .codo/config.json found. Creating default config...\x1b[0m');
    try {
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configPath, DEFAULT_CONFIG_CONTENT, 'utf-8');
      console.log('\x1b[33m⚠ Please edit .codo/config.json and add your API key\x1b[0m');
    } catch (mkdirErr) {
      // Continue - will fail later with proper error
    }
    fileContent = DEFAULT_CONFIG_CONTENT;
  }

  let rawConfig: any = {};
  if (fileContent.trim()) {
    try {
      rawConfig = JSON.parse(fileContent);
    } catch (err) {}
  }

  const config: Partial<CodoConfig> = {};

  if (rawConfig.providers) {
    let activeProvider = rawConfig.defaultProvider;
    let apiKey = activeProvider && rawConfig.providers[activeProvider]?.apiKey;

    // Auto fallback
    if (!apiKey) {
      const validFallback = Object.entries(rawConfig.providers).find(
        ([name, data]: any) => data.apiKey && data.apiKey.trim() !== '',
      );
      if (validFallback) {
        activeProvider = validFallback[0];
        apiKey = (validFallback[1] as any).apiKey;
        console.log(
          `\x1b[33m⚠ Falling back to provider ${activeProvider} because default had no key\x1b[0m`,
        );
      }
    }

    if (!apiKey && activeProvider !== 'ollama') {
      console.log('✗ No API key found in .codo/config.json');
      process.exit(1);
    }

    // Map google to gemini for internal use
    let mappedProvider = activeProvider === 'google' ? 'gemini' : activeProvider;

    config.provider = mappedProvider;
    config.apiKey = apiKey;
    config.model = rawConfig.providers[activeProvider]?.model;
  } else {
    config.provider = rawConfig.provider;
    config.apiKey = rawConfig.apiKey;
    config.model = rawConfig.model;
    config.maxAgents = rawConfig.maxAgents;
    config.ollamaBaseUrl = rawConfig.ollamaBaseUrl;

    if (!config.apiKey && config.provider !== 'ollama') {
      console.log('✗ No API key found in .codo/config.json');
      process.exit(1);
    }
  }

  const validProviders = [
    'anthropic',
    'gemini',
    'google',
    'openai',
    'moonshot',
    'ollama',
    'opencode',
    'groq',
    'openrouter',
  ];
  if (config.provider && !validProviders.includes(config.provider)) {
    console.log(
      `✗ Unknown provider: ${config.provider}. Supported: anthropic, gemini, openai, moonshot, ollama, opencode, groq, openrouter`,
    );
    process.exit(1);
  }

  if (config.provider === 'ollama' && !config.ollamaBaseUrl) {
    config.ollamaBaseUrl = 'http://localhost:11434';
  }

  if (!config.model && config.provider) {
    config.model = PROVIDER_DEFAULTS[config.provider] || 'gemini-2.5-flash';
  }

  return {
    ...DEFAULT_CONFIG,
    ...config,
  } as CodoConfig;
}

export async function saveConfig(config: CodoConfig): Promise<void> {
  const configPath = join(process.cwd(), '.codo', 'config.json');
  let rawConfig: any = {};
  try {
    const fileContent = await fs.readFile(configPath, 'utf-8');
    rawConfig = JSON.parse(fileContent);
  } catch (e) {}

  if (rawConfig.providers) {
    let provKey = config.provider === 'gemini' ? 'google' : config.provider;
    if (!rawConfig.providers[provKey]) {
      rawConfig.providers[provKey] = { enabled: false, apiKey: '' };
    }
    rawConfig.providers[provKey].apiKey = config.apiKey;
    rawConfig.providers[provKey].model = config.model;
    rawConfig.providers[provKey].enabled = true;
    rawConfig.defaultProvider = provKey;
    await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2), 'utf-8');
  } else {
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }
  cachedConfig = config;
}

export async function updateProviderApiKey(
  provider: CodoConfig['provider'],
  apiKey: string,
): Promise<CodoConfig> {
  const config = await loadConfig();
  config.apiKey = apiKey;
  if (provider !== 'ollama') {
    config.provider = provider === 'google' ? 'gemini' : provider;
  }
  await saveConfig(config);
  return config;
}
