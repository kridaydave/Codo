import React, { useState, useEffect } from 'react';
import { Text, Box, useInput, useApp } from 'ink';
import { ChatMode, type ChatMessage } from './ui/chat-mode.js';
import { AgentRow } from './ui/agent-row.js';
import { LiveOutput } from './ui/live-output.js';
import { A2ALog } from './ui/a2a-log.js';
import { StatusBar } from './ui/status-bar.js';
import { processChatInput } from './chat/chat-router.js';
import { loadConfig, updateProviderApiKey, saveConfig } from './config/config.js';
import { orchestrator, type AgentState } from './orchestrator/orchestrator.js';

interface AppProps {
  task: string;
  provider?: string;
}

export default function App({ task: initialTask, provider }: AppProps) {
  const { exit } = useApp();
  const [mode, setMode] = useState<'chat' | 'task'>(initialTask ? 'task' : 'chat');
  const [inputValue, setInputValue] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [currentConfig, setCurrentConfig] = useState<any>(null);

  // Interactive connection state
  const [isConnecting, setIsConnecting] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);

  // Task state
  const [agentState, setAgentState] = useState<AgentState>(orchestrator.agentState);
  const [logs, setLogs] = useState<string[]>([]);
  const [tokens, setTokens] = useState(0);
  const [sessionCost, setSessionCost] = useState(0);
  const [hasExited, setHasExited] = useState(false);

  useEffect(() => {
    orchestrator.initialize(provider as any);

    (async () => {
      const cfg = await loadConfig();
      setCurrentConfig(cfg);
    })();

    const onStateChange = (state: AgentState) => {
      setAgentState({ ...state });
    };

    const onAction = (action: string) => {
      setLogs((prev) => [...prev, action]);
      setTokens((t) => t + Math.floor(Math.random() * 50) + 10); // Dummy token usage for now
      setSessionCost((c) => c + 0.001);
    };

    const onToolCall = (tool: any) => {
      setLogs((prev) => [...prev, `✎ ${tool.name}  ${JSON.stringify(tool.input).slice(0, 30)}`]);
    };

    const onToolResult = (res: any) => {
      setLogs((prev) => [...prev, `✓ ${res.tool} completed`]);
    };

    orchestrator.on('agent:state', onStateChange);
    orchestrator.on('agent:action', onAction);
    orchestrator.on('agent:tool_call', onToolCall);
    orchestrator.on('agent:tool_result', onToolResult);

    if (initialTask && mode === 'task') {
      orchestrator.runTask(initialTask).catch(() => { });
    }

    return () => {
      orchestrator.removeListener('agent:state', onStateChange);
      orchestrator.removeListener('agent:action', onAction);
      orchestrator.removeListener('agent:tool_call', onToolCall);
      orchestrator.removeListener('agent:tool_result', onToolResult);
    };
  }, [provider, initialTask]);

  useInput((input, key) => {
    // Intercept escape key during connection flow to cancel
    if (key.escape && isConnecting) {
      setIsConnecting(false);
      setPendingProvider(null);
      return;
    }

    if (key.escape || (input === 'q' && mode === 'task')) {
      orchestrator.abort();
      setHasExited(true);
      exit();
      return;
    }
  });

  const handleProviderSelect = (selectedProvider: string) => {
    setPendingProvider(selectedProvider);
    setIsConnecting(false);
  };

  const handleChatSubmit = async (val: string) => {
    const input = val.trim();
    if (!input) return;

    if (pendingProvider) {
      // User is providing an API key for the pending provider
      setInputValue('');
      setIsConnecting(false);
      const provider = pendingProvider;
      setPendingProvider(null);

      // Mask the API key in the UI for security
      setChatMessages((prev) => [
        ...prev,
        { role: 'user', content: '********' }
      ]);

      try {
        const newConfig = await updateProviderApiKey(provider as any, input);
        setCurrentConfig(newConfig);
        setChatMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `✓ Connected to ${provider}. API key saved to .codo/config.json`,
          },
        ]);
      } catch (err: any) {
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `✗ Error: ${err.message}` },
        ]);
      }
      return;
    }

    // Handle /connect command
    if (input.startsWith('/connect')) {
      setInputValue('');
      const parts = input.slice(8).trim().split(' ');

      // If no arguments, open the interactive menu
      if (parts.length === 1 && parts[0] === '') {
        setIsConnecting(true);
        setChatMessages((prev) => [
          ...prev,
          { role: 'user', content: '/connect' }
        ]);
        return;
      }

      const provider = parts[0] as 'anthropic' | 'gemini' | 'moonshot' | 'opencode';
      const apiKey = parts.slice(1).join(' ');

      if (!provider || !apiKey) {
        setChatMessages((prev) => [
          ...prev,
          { role: 'user', content: input },
          {
            role: 'assistant',
            content: 'Usage: /connect <provider> <apiKey>\nExample: /connect anthropic sk-...',
          },
        ]);
        return;
      }

      if (!['anthropic', 'gemini', 'moonshot', 'opencode'].includes(provider)) {
        setChatMessages((prev) => [
          ...prev,
          { role: 'user', content: input },
          {
            role: 'assistant',
            content: 'Invalid provider. Supported: anthropic, gemini, moonshot, opencode',
          },
        ]);
        return;
      }

      try {
        const newConfig = await updateProviderApiKey(provider, apiKey);
        setCurrentConfig(newConfig);
        setChatMessages((prev) => [
          ...prev,
          { role: 'user', content: input },
          {
            role: 'assistant',
            content: `✓ Connected to ${provider}. API key saved to .codo/config.json`,
          },
        ]);
      } catch (err: any) {
        setChatMessages((prev) => [
          ...prev,
          { role: 'user', content: input },
          { role: 'assistant', content: `✗ Error: ${err.message}` },
        ]);
      }
      return;
    }

    // Handle /model command
    if (input.startsWith('/model')) {
      setInputValue('');
      const modelArg = input.slice(6).trim();

      const modelOptions: Record<string, string[]> = {
        anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
        gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
        moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
        ollama: ['llama3', 'llama3.1', 'llama3.2', 'mistral', 'codellama', 'phi3'],
        opencode: [
          'minimax-m2.5',
          'minimax-m2.1',
          'glm-5',
          'kimi-k2.5',
          'opencode/gpt-5.2',
          'opencode/claude-3.5-sonnet',
        ],
      };

      const currentProvider = currentConfig?.provider || 'gemini';
      const availableModels = modelOptions[currentProvider] || [];

      if (!modelArg) {
        setChatMessages((prev) => [
          ...prev,
          { role: 'user', content: input },
          {
            role: 'assistant',
            content: `Available models for ${currentProvider}:\n${availableModels.map((m) => `  • ${m}`).join('\n')}\n\nUse: /model <model-name>`,
          },
        ]);
        return;
      }

      if (!availableModels.includes(modelArg)) {
        setChatMessages((prev) => [
          ...prev,
          { role: 'user', content: input },
          {
            role: 'assistant',
            content: `Invalid model '${modelArg}' for ${currentProvider}.\nAvailable: ${availableModels.join(', ')}`,
          },
        ]);
        return;
      }

      const updatedConfig = { ...currentConfig, model: modelArg };
      await saveConfig(updatedConfig);
      setCurrentConfig(updatedConfig);

      setChatMessages((prev) => [
        ...prev,
        { role: 'user', content: input },
        { role: 'assistant', content: `✓ Switched to ${currentProvider}/${modelArg}` },
      ]);
      return;
    }

    setInputValue('');

    setChatMessages((prev) => [
      ...prev,
      { role: 'user', content: input },
    ]);

    try {
      const { isTask, response } = await processChatInput(input, currentConfig?.provider || provider, chatMessages);

      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: response },
      ]);

      if (isTask) {
        setMode('task');
        orchestrator.runTask(input).catch(() => { });
      }
    } catch (err: any) {
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `✗ Error: ${err.message}` },
      ]);
    }
  };

  if (hasExited) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="gray">── Codo Session Summary ──────────────────────────</Text>
        <Text>Tasks completed 1/1</Text>
        <Text>Total tokens {tokens.toLocaleString()}</Text>
        <Text>Estimated cost ${sessionCost.toFixed(2)}</Text>
        <Text>Agents used 1</Text>
        <Text>A2A exchanges 0</Text>
        <Text color="gray">──────────────────────────────────────────────────</Text>
      </Box>
    );
  }

  // Header line
  const header = (
    <Box flexDirection="column" marginBottom={1} paddingX={1} paddingTop={1}>
      <Box justifyContent="flex-start">
        <Text color="#32CD32" bold>
          Welcome to
        </Text>
        <Text color="white" bold> Codo Code</Text>
        <Text color="white">!</Text>
      </Box>
      <Box marginTop={1} flexDirection="row" width="100%">
        <Box flexDirection="column" width="50%">
          <Text color="#32CD32">{'     _.-^^---....,,--       '}</Text>
          <Text color="#32CD32">{' _--                  --_  '}</Text>
          <Text color="#32CD32">{'<                        >)'}</Text>
          <Text color="#32CD32">{' |                         | '}</Text>
          <Text color="#32CD32">{'  \\._                   _./  '}</Text>
          <Text color="#32CD32">{'     ```--. . , ; .--\'\'\'       '}</Text>
          <Text color="#32CD32">{'           | |   |             '}</Text>
          <Text color="#32CD32">{'        .-=||  | |=-.        '}</Text>
          <Text color="#32CD32">{'        `-=#$%&%$#=-\'        '}</Text>
          <Text color="#32CD32">{'           | ;  :|           '}</Text>
          <Text color="#32CD32">{'  _____.,-#%&$@%#&#~,._____  '}</Text>

          <Box marginTop={1} flexDirection="column">
            <Text color="gray">v1.2.0 · {currentConfig?.provider || provider}/{currentConfig?.model || ''}</Text>
            <Text color="gray">{process.cwd()}</Text>
          </Box>
        </Box>

        <Box flexDirection="column" width="50%" paddingLeft={2} borderStyle="single" borderLeft borderColor="#333333" borderRight={false} borderTop={false} borderBottom={false}>
          <Text color="#32CD32" bold>Tips for getting started</Text>
          <Text color="white">Run /connect to connect to an API provider</Text>
          <Text color="white">Run /model to select a specific model</Text>
          <Text color="white">Be as specific as you would with another engineer for the best results</Text>

          <Box marginTop={1} flexDirection="column">
            <Text color="#32CD32" bold>Recent activity</Text>
            <Text color="gray">No recent activity</Text>
          </Box>
        </Box>
      </Box>
      <Text color="#333333">─────────────────────────────────────────────────────────────────</Text>
    </Box>
  );

  return (
    <Box flexDirection="column" paddingX={1} width={100} borderStyle="round" borderColor="#32CD32">
      {header}

      {mode === 'chat' ? (
        <ChatMode
          messages={chatMessages}
          inputValue={inputValue}
          onChange={setInputValue}
          onSubmit={handleChatSubmit}
          model={currentConfig?.provider || provider || 'gemini'}
          isConnecting={isConnecting}
          onProviderSelect={handleProviderSelect}
          onConnectCancel={() => setIsConnecting(false)}
          isEnteringKey={!!pendingProvider}
          pendingProviderName={pendingProvider || undefined}
        />
      ) : (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color="white">
              ▸ AGENTS{' '}
            </Text>
            <Text color="gray" dimColor>
              ──────────────────────────────────────────
            </Text>
          </Box>

          <AgentRow state={agentState} />

          <Box marginY={1} justifyContent="center" width={50}>
            <Text color="gray" dimColor>
              more agents coming in phase 4...
            </Text>
          </Box>

          <LiveOutput agentId={agentState.id} logs={logs} />
          <A2ALog />
          <StatusBar tokensUsed={tokens} cost={sessionCost} />
        </Box>
      )}
    </Box>
  );
}
