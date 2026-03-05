import React, { useState, useEffect } from 'react';
import { Text, Box, useInput, useApp } from 'ink';
import { ChatMode, type ChatMessage } from './ui/chat-mode.js';
import { AgentRow } from './ui/agent-row.js';
import { LiveOutput } from './ui/live-output.js';
import { A2AFeed } from './ui/A2AFeed.js';
import { StatusBar } from './ui/status-bar.js';
import { ResumePrompt, type CheckpointOffer } from './ui/resume-prompt.js';
import { processChatInput } from './chat/chat-router.js';
import {
  loadConfig,
  updateProviderApiKey,
  saveConfig,
  type ProviderType,
} from './config/config.js';
import { orchestrator, type AgentState } from './orchestrator/orchestrator.js';
import { historyManager, type HistoryEntry } from './core/history-manager.js';
import type { ApprovalRequest } from './orchestrator/approval-flow.js';
import { DiffGenerator } from './git/index.js';

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
  const [isSelectingModel, setIsSelectingModel] = useState(false);

  // Task state
  const [agentState, setAgentState] = useState<AgentState>(orchestrator.agentState);
  const [agentStates, setAgentStates] = useState<AgentState[]>([orchestrator.agentState]);
  const [a2aMessages, setA2AMessages] = useState<string[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [tokens, setTokens] = useState(0);
  const [sessionCost, setSessionCost] = useState(0);
  const [approvalRequest, setApprovalRequest] = useState<ApprovalRequest | null>(null);
  const [checkpointOffer, setCheckpointOffer] = useState<CheckpointOffer | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [hasExited, setHasExited] = useState(false);

  useEffect(() => {
    (async () => {
      const cfg = await loadConfig();
      setCurrentConfig(cfg);
      await orchestrator.initialize(
        (cfg?.provider || provider) as ProviderType,
        cfg?.maxAgents ?? 4,
      );
      const h = await historyManager.loadHistory();
      setHistory(h);
    })();

    const onStateChange = (state: AgentState) => {
      setAgentState({ ...state });
    };

    const onAction = (action: string) => {
      setLogs((prev) => [...prev, action]);
    };

    const onUsage = (usage: any) => {
      setTokens((t) => t + usage.totalTokens);
      // Rough estimation: $0.01 per 1k tokens
      setSessionCost((c) => c + (usage.totalTokens / 1000) * 0.01);
    };

    const onToolCall = (tool: any) => {
      setLogs((prev) => [...prev, `✎ ${tool.name}  ${JSON.stringify(tool.input).slice(0, 30)}`]);
    };

    const onToolResult = (res: any) => {
      setLogs((prev) => [...prev, `✓ ${res.tool} completed`]);
    };

    const onApprovalRequest = (request: ApprovalRequest) => {
      setApprovalRequest(request);
    };

    const onApprovalComplete = () => {
      setApprovalRequest(null);
    };

    const onAllStatesChange = (states: AgentState[]) => {
      setAgentStates([...states]);
    };

    const onA2ADelegation = (msg: {
      from?: string;
      to?: string[];
      subtasks?: string[];
      method?: string;
    }) => {
      if (!Array.isArray(msg.to) || !Array.isArray(msg.subtasks)) return; // guard against wrong-shape events
      setA2AMessages((prev) => [
        ...prev,
        `[${msg.method ?? 'auto'}] → [${msg.to!.join(', ')}]: ${msg.subtasks!.length} subtasks`,
      ]);
    };

    const onCheckpointFound = (offer: CheckpointOffer) => {
      setCheckpointOffer(offer);
    };

    orchestrator.on('agent:state', onStateChange);
    orchestrator.on('agents:state', onAllStatesChange);
    orchestrator.on('agent:action', onAction);
    orchestrator.on('agent:usage', onUsage);
    orchestrator.on('agent:tool_call', onToolCall);
    orchestrator.on('agent:tool_result', onToolResult);
    orchestrator.on('a2a:delegation', onA2ADelegation);
    orchestrator.on('checkpoint:found', onCheckpointFound);
    orchestrator.approvalFlow.on('approval:request', onApprovalRequest);
    orchestrator.approvalFlow.on('approval:complete', onApprovalComplete);

    if (initialTask && mode === 'task') {
      setChatMessages((prev) => [...prev, { role: 'user', content: initialTask }]);
      orchestrator
        .runTask(initialTask)
        .then((res) => {
          setChatMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Task completed. Result:\n${res}` },
          ]);
          setMode('chat');
        })
        .catch((err) => {
          setChatMessages((prev) => [
            ...prev,
            { role: 'assistant', content: `Task failed: ${err.message}` },
          ]);
          setMode('chat');
        });
    }

    return () => {
      orchestrator.removeListener('agent:state', onStateChange);
      orchestrator.removeListener('agents:state', onAllStatesChange);
      orchestrator.removeListener('agent:action', onAction);
      orchestrator.removeListener('agent:usage', onUsage);
      orchestrator.removeListener('agent:tool_call', onToolCall);
      orchestrator.removeListener('agent:tool_result', onToolResult);
      orchestrator.removeListener('a2a:delegation', onA2ADelegation);
      orchestrator.removeListener('checkpoint:found', onCheckpointFound);
      orchestrator.approvalFlow.removeListener('approval:request', onApprovalRequest);
      orchestrator.approvalFlow.removeListener('approval:complete', onApprovalComplete);
    };
  }, [provider, initialTask]);

  useEffect(() => {
    if (mode === 'task' && (agentState.status === 'done' || agentState.status === 'error')) {
      const duration =
        agentState.endTime && agentState.startTime
          ? `${((agentState.endTime - agentState.startTime) / 1000).toFixed(1)}s`
          : '';

      let summary = `Task completed in ${duration}\n\n`;

      if (agentState.status === 'error') {
        summary = `Task failed: ${orchestrator.lastTaskError || 'Unknown error'}`;
      } else if (orchestrator.lastTaskResult) {
        summary = `Task completed successfully in ${duration}\n\n${orchestrator.lastTaskResult}`;
      }

      setChatMessages((prev) => [...prev, { role: 'assistant', content: summary }]);
      setMode('chat');
      historyManager.loadHistory().then(setHistory);
    }
  }, [agentState.status]);

  useInput((input, key) => {
    // Block other shortcuts if we are showing a checkpoint prompt
    if (checkpointOffer) {
      return;
    }

    // Handle approval decisions
    if (approvalRequest && agentState.status === 'awaiting_approval') {
      if (input === 'm' || input === 'M') {
        orchestrator.approvalFlow.submitDecision({ decision: 'merge' });
        return;
      }
      if (input === 'c' || input === 'C') {
        orchestrator.approvalFlow.submitDecision({ decision: 'cancel' });
        return;
      }
      // Block other input during approval
      return;
    }

    // Intercept escape key during connection flow to cancel
    if (key.escape && isConnecting) {
      setIsConnecting(false);
      setPendingProvider(null);
      return;
    }

    if (key.escape && isSelectingModel) {
      setIsSelectingModel(false);
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

  const modelOptionsMap: Record<string, string[]> = {
    anthropic: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-flash'],
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
    groq: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'llama3-8b-8192',
      'llama3-70b-8192',
      'mixtral-8x7b-32768',
      'gemma-7b-it',
      'gemma2-9b-it',
    ],
    openrouter: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-2.5-pro'],
  };

  const handleModelSelect = async (selectedModel: string) => {
    setIsSelectingModel(false);
    const currentProvider = currentConfig?.provider || 'gemini';
    const updatedConfig = { ...currentConfig, model: selectedModel };
    await saveConfig(updatedConfig);
    setCurrentConfig(updatedConfig);

    setChatMessages((prev) => [
      ...prev,
      { role: 'assistant', content: `✓ Switched to ${currentProvider}/${selectedModel}` },
    ]);
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
      setChatMessages((prev) => [...prev, { role: 'user', content: '********' }]);

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
        setChatMessages((prev) => [...prev, { role: 'user', content: '/connect' }]);
        return;
      }

      const provider = parts[0] as
        | 'anthropic'
        | 'gemini'
        | 'moonshot'
        | 'opencode'
        | 'groq'
        | 'openrouter';
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

      if (
        !['anthropic', 'gemini', 'moonshot', 'opencode', 'groq', 'openrouter'].includes(provider)
      ) {
        setChatMessages((prev) => [
          ...prev,
          { role: 'user', content: input },
          {
            role: 'assistant',
            content:
              'Invalid provider. Supported: anthropic, gemini, moonshot, opencode, groq, openrouter',
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

      const currentProvider = currentConfig?.provider || 'gemini';
      const availableModels = modelOptionsMap[currentProvider] || [];

      if (!modelArg) {
        setIsSelectingModel(true);
        setChatMessages((prev) => [...prev, { role: 'user', content: '/model' }]);
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

    setChatMessages((prev) => [...prev, { role: 'user', content: input }]);

    try {
      const { isTask, response } = await processChatInput(
        input,
        currentConfig?.provider || provider,
        chatMessages,
      );

      setChatMessages((prev) => [...prev, { role: 'assistant', content: response }]);

      if (isTask) {
        setMode('task');
        setLogs([]);
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
      <Box justifyContent="space-between">
        <Box flexDirection="row">
          <Text color="#32CD32" bold>
            Codo Code
          </Text>
          <Text color="gray"> · CLI Assistant v1.2.0</Text>
        </Box>
        <Text color="gray">{process.cwd()}</Text>
      </Box>
      <Box marginTop={1} flexDirection="row" width="100%">
        <Box flexDirection="column" width="50%">
          <Text color="#32CD32" bold>
            {'   ____ ___  ____  ____ '}
          </Text>
          <Text color="#32CD32" bold>
            {'  / ___/ _ \\/ __ \\/ __ \\'}
          </Text>
          <Text color="#32CD32" bold>
            {' / /  / (_) / /_/ / /_/ /'}
          </Text>
          <Text color="#32CD32" bold>
            {' \\____\\___/\\____/\\____/ '}
          </Text>

          <Box marginTop={1} flexDirection="column">
            <Text color="white">
              {currentConfig?.provider || provider || 'gemini'} / {currentConfig?.model || ''}
            </Text>
            <Text color="gray" dimColor>
              System active · {agentStates.length} agents available
            </Text>
          </Box>
        </Box>

        <Box
          flexDirection="column"
          width="50%"
          paddingLeft={2}
          borderStyle="single"
          borderLeft
          borderColor="#333333"
          borderRight={false}
          borderTop={false}
          borderBottom={false}
        >
          <Text color="#32CD32" bold>
            Tips for getting started
          </Text>
          <Text color="white">Run /connect to connect to an API provider</Text>
          <Text color="white">Run /model to select a specific model</Text>
          <Text color="white">
            Be as specific as you would with another engineer for the best results
          </Text>

          <Box marginTop={1} flexDirection="column">
            <Text color="#32CD32" bold>
              Recent activity
            </Text>
            {history.length > 0 ? (
              history.slice(0, 3).map((entry, idx) => (
                <Box key={idx} flexDirection="column">
                  <Text color="white" wrap="truncate-end">
                    {entry.status === 'done' ? '✓' : '✗'} {entry.task.slice(0, 40)}
                  </Text>
                  <Text color="gray" dimColor>
                    {new Date(entry.timestamp).toLocaleTimeString()} · {entry.duration ? (entry.duration / 1000).toFixed(1) : '?'}s
                  </Text>
                </Box>
              ))
            ) : (
              <Text color="gray">No recent activity</Text>
            )}
          </Box>
        </Box>
      </Box>
      <Text color="#333333">─────────────────────────────────────────────────────────────────</Text>
    </Box>
  );

  return (
    <Box flexDirection="column" paddingX={1} width={100} borderStyle="round" borderColor="#32CD32">
      {header}

      {checkpointOffer ? (
        <ResumePrompt
          checkpoint={checkpointOffer}
          onDecision={(decision) => {
            if (decision === 'resume') {
              setMode('task');
              setLogs([]);
              setChatMessages((prev) => [
                ...prev,
                { role: 'user', content: `[Resuming task: ${checkpointOffer.task.slice(0, 50)}...]` },
              ]);
              orchestrator.resumeFromCheckpoint(checkpointOffer.taskId).catch(() => { });
            } else {
              orchestrator.dismissCheckpoint(checkpointOffer.taskId).catch(() => { });
            }
            setCheckpointOffer(null);
          }}
        />
      ) : mode === 'chat' ? (
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
          isSelectingModel={isSelectingModel}
          onModelSelect={handleModelSelect}
          modelOptions={(modelOptionsMap[currentConfig?.provider || provider || 'gemini'] || []).map(
            (m) => ({ label: m, value: m }),
          )}
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

          {/* Render one row per active agent */}
          {agentStates.map((state) => (
            <AgentRow key={state.id} state={state} />
          ))}

          {approvalRequest && agentState.status === 'awaiting_approval' ? (
            <Box flexDirection="column" marginY={1} paddingX={1}>
              <Text bold color="yellow">
                ═══ Approval Required ═══════════════════════════
              </Text>
              <Box marginY={1} flexDirection="column">
                <Text color="white">Task: {approvalRequest.task.slice(0, 80)}</Text>
                <Text color="white">{new DiffGenerator().formatForUser(approvalRequest.diff)}</Text>
                <Box marginTop={1}>
                  <Text color="white">Agent summary: </Text>
                  <Text color="gray">{approvalRequest.agentSummary.slice(0, 200)}</Text>
                </Box>
              </Box>
              <Box marginTop={1}>
                <Text color="#32CD32" bold>
                  [M]
                </Text>
                <Text color="white">erge to main </Text>
                <Text color="red" bold>
                  [C]
                </Text>
                <Text color="white">ancel (discard)</Text>
              </Box>
            </Box>
          ) : (
            <LiveOutput agentId={agentState.id} logs={logs} />
          )}
          <A2AFeed />
          <StatusBar tokensUsed={tokens} cost={sessionCost} status={agentState.status} />
        </Box>
      )}
    </Box>
  );
}
