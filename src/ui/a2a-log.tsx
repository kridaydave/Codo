import React from 'react';
import { Text, Box } from 'ink';

export function A2ALog() {
    return (
        <Box flexDirection="column" marginTop={1}>
            <Box>
                <Text bold color="white">▸ A2A LOG </Text>
                <Text color="gray" dimColor>─────────────────────────────────────────</Text>
            </Box>
            <Box paddingLeft={2}>
                <Text color="gray" dimColor>No exchanges yet — agents working independently</Text>
            </Box>
        </Box>
    );
}
