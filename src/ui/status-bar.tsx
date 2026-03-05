import React from 'react';
import { Text, Box } from 'ink';

interface StatusBarProps {
    tokensUsed: number;
    cost: number;
    status?: string;
}

export function StatusBar({ tokensUsed, cost, status }: StatusBarProps) {
    const getStatusText = () => {
        if (!status) return 'idle';
        if (status === 'thinking') return '🤔 thinking...';
        if (status === 'acting') return '⚙ acting...';
        if (status === 'awaiting_approval') return '⏳ awaiting approval';
        if (status === 'done') return '✅ done';
        if (status === 'error') return '❌ error';
        return status;
    };

    return (
        <Box flexDirection="column" marginTop={1}>
            <Box marginY={0}>
                <Text color="gray">══════════════════════════════════════════════════</Text>
            </Box>
            <Box justifyContent="space-between">
                <Text color="gray">
                    tokens {tokensUsed.toLocaleString()}  ·  ~${cost.toFixed(2)}  ·  <Text bold color="white">q</Text> quit  <Text bold color="white">d</Text> diff  <Text bold color="white">m</Text> merge  <Text bold color="white">tab</Text> agent
                </Text>
                <Text color="#32CD32" bold>{getStatusText()}</Text>
            </Box>
        </Box>
    );
}
