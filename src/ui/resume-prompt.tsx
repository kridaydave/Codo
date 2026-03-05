import React from 'react';
import { Text, Box, useInput } from 'ink';

export interface CheckpointOffer {
    taskId: string;
    task: string;
    agentCount: number;
    updatedAt: number;
}

interface ResumePromptProps {
    checkpoint: CheckpointOffer;
    onDecision: (decision: 'resume' | 'dismiss') => void;
}

export function ResumePrompt({ checkpoint, onDecision }: ResumePromptProps) {
    useInput((input, key) => {
        if (input.toLowerCase() === 'y' || key.return) {
            onDecision('resume');
        } else if (input.toLowerCase() === 'n' || key.escape) {
            onDecision('dismiss');
        }
    });

    return (
        <Box flexDirection="column" paddingX={1} marginY={1} borderStyle="round" borderColor="yellow">
            <Box marginBottom={1}>
                <Text bold color="yellow">⚠️ Incomplete Task Detected</Text>
            </Box>
            <Box flexDirection="column" marginBottom={1}>
                <Text color="white">A previous task was interrupted before it could finish.</Text>
                <Text color="gray">Task: {checkpoint.task.slice(0, 100)}{checkpoint.task.length > 100 ? '...' : ''}</Text>
                <Text color="gray">Last saved: {new Date(checkpoint.updatedAt).toLocaleString()}</Text>
            </Box>
            <Box>
                <Text bold>Resume this task? </Text>
                <Text color="#32CD32" bold>[Y]</Text>
                <Text color="white">es / </Text>
                <Text color="red" bold>[N]</Text>
                <Text color="white">o (discard)</Text>
            </Box>
        </Box>
    );
}
