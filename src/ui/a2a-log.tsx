import React from 'react';
import { Text, Box } from 'ink';

interface A2ALogProps {
    messages?: string[];
}

export function A2ALog({ messages = [] }: A2ALogProps) {
    return (
        <Box flexDirection="column" marginTop={1}>
            <Box>
                <Text bold color="white">▸ A2A LOG </Text>
                <Text color="gray" dimColor>─────────────────────────────────────────</Text>
            </Box>
            <Box paddingLeft={2} flexDirection="column">
                {messages.length === 0 ? (
                    <Text color="gray" dimColor>No exchanges yet — agents working independently</Text>
                ) : (
                    messages.slice(-5).map((msg, i) => (
                        <Text key={i} color="cyan" dimColor>⇄ {msg}</Text>
                    ))
                )}
            </Box>
        </Box>
    );
}
