import React from 'react';
import { Text, Box } from 'ink';
import TextInput from 'ink-text-input';

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface ChatModeProps {
    messages: ChatMessage[];
    inputValue: string;
    onChange: (value: string) => void;
    onSubmit: (value: string) => void;
    model: string;
}

export function ChatMode({ messages, inputValue, onChange, onSubmit, model }: ChatModeProps) {
    return (
        <Box flexDirection="column">
            <Box marginBottom={1}>
                <Text color="gray">Welcome to Codo. Type a task to start, or ask me anything.</Text>
            </Box>
            <Text color="gray">──────────────────────────────────────────────────────────</Text>

            <Box flexDirection="column" marginY={1}>
                {messages.map((m, i) => (
                    <Box key={i} flexDirection="column" marginBottom={1}>
                        {m.role === 'user' ? (
                            <Text>{'> '} <Text>{m.content}</Text></Text>
                        ) : (
                            <Text>{m.content}</Text>
                        )}
                    </Box>
                ))}
            </Box>

            <Text color="gray">──────────────────────────────────────────────────────────</Text>
            <Text color="gray">● connected  · {model}  · 0 tokens used</Text>
            <Box>
                <Box marginRight={1}>
                    <Text>{'>'}</Text>
                </Box>
                <TextInput value={inputValue} onChange={onChange} onSubmit={onSubmit} />
            </Box>
        </Box>
    );
}
