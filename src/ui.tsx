import React, { useState, useEffect } from 'react';
import { Text, Box, useInput, useApp } from 'ink';
import { ChatMode, type ChatMessage } from './ui/chat-mode.js';
import { AgentRow } from './ui/agent-row.js';
import { LiveOutput } from './ui/live-output.js';
import { A2ALog } from './ui/a2a-log.js';
import { StatusBar } from './ui/status-bar.js';
import { isTaskPrompt, generateChatResponse } from './chat/chat-router.js';
import { orchestrator, type AgentState } from './orchestrator/orchestrator.js';

interface AppProps {
  task: string;
  provider?: 'anthropic' | 'google' | 'openai' | 'ollama';
}

export default function App({ task: initialTask, provider = 'anthropic' }: AppProps) {
  const { exit } = useApp();
  const [mode, setMode] = useState<'chat' | 'task'>(initialTask ? 'task' : 'chat');
  const [inputValue, setInputValue] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  // Task state
  const [agentState, setAgentState] = useState<AgentState>(orchestrator.agentState);
  const [logs, setLogs] = useState<string[]>([]);
  const [tokens, setTokens] = useState(0);
  const [sessionCost, setSessionCost] = useState(0);
  const [hasExited, setHasExited] = useState(false);

  useEffect(() => {
    orchestrator.initialize(provider as any);

    const onStateChange = (state: AgentState) => {
      setAgentState({ ...state });
    };

    const onAction = (action: string) => {
      setLogs(prev => [...prev, action]);
      setTokens(t => t + Math.floor(Math.random() * 50) + 10); // Dummy token usage for now
      setSessionCost(c => c + 0.001);
    };

    const onToolCall = (tool: any) => {
      setLogs(prev => [...prev, `✎ ${tool.name}  ${JSON.stringify(tool.input).slice(0, 30)}`]);
    };

    const onToolResult = (res: any) => {
      setLogs(prev => [...prev, `✓ ${res.tool} completed`]);
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
    // Only intercept q for quitting during the task mode or any exit signal
    if (key.escape || (input === 'q' && mode === 'task')) {
      orchestrator.abort();
      setHasExited(true);
      exit();
      return;
    }
  });

  const handleChatSubmit = (val: string) => {
    const input = val.trim();
    if (!input) return;

    setInputValue('');

    if (isTaskPrompt(input)) {
      setMode('task');
      orchestrator.runTask(input).catch(() => { });
    } else {
      const response = generateChatResponse(input);
      setChatMessages(prev => [
        ...prev,
        { role: 'user', content: input },
        { role: 'assistant', content: response }
      ]);
    }
  };

  if (hasExited) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="gray">── Codo Session Summary ──────────────────────────</Text>
        <Text>Tasks completed   1/1</Text>
        <Text>Total tokens      {tokens.toLocaleString()}</Text>
        <Text>Estimated cost    ${sessionCost.toFixed(2)}</Text>
        <Text>Agents used       1</Text>
        <Text>A2A exchanges     0</Text>
        <Text color="gray">──────────────────────────────────────────────────</Text>
      </Box>
    );
  }

  // Header line
  const header = (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="cyan" bold>⚡ codo  </Text>
        <Text>v0.1.0              {provider}/flash  ~/codo</Text>
      </Box>
      <Text color="gray">══════════════════════════════════════════════════</Text>
    </Box>
  );

  return (
    <Box flexDirection="column" paddingX={1} width={80}>
      {header}

      {mode === 'chat' ? (
        <ChatMode
          messages={chatMessages}
          inputValue={inputValue}
          onChange={setInputValue}
          onSubmit={handleChatSubmit}
          model={provider}
        />
      ) : (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color="white">▸ AGENTS </Text>
            <Text color="gray" dimColor>──────────────────────────────────────────</Text>
          </Box>

          <AgentRow state={agentState} />

          <Box marginY={1} justifyContent="center" width={50}>
            <Text color="gray" dimColor>more agents coming in phase 4...</Text>
          </Box>

          <LiveOutput agentId={agentState.id} logs={logs} />
          <A2ALog />
          <StatusBar tokensUsed={tokens} cost={sessionCost} />
        </Box>
      )}
    </Box>
  );
}
