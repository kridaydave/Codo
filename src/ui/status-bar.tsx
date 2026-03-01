import React from 'react';
import { Text, Box } from 'ink';

interface StatusBarProps {
    tokensUsed: number;
    cost: number;
}

export function StatusBar({ tokensUsed, cost }: StatusBarProps) {
    return (
        <Box flexDirection="column" marginTop={1}>
            <Box marginY={0}>
                <Text color="gray">══════════════════════════════════════════════════</Text>
            </Box>
            <Text color="gray">
                tokens {tokensUsed.toLocaleString()}  ·  ~${cost.toFixed(2)}  ·  <Text bold color="white">q</Text> quit  <Text bold color="white">d</Text> diff  <Text bold color="white">m</Text> merge  <Text bold color="white">tab</Text> agent
            </Text>
        </Box>
    );
}
