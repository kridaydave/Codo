import React from 'react';
import { Text, Box, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { TypingText } from './typing-text.js';

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
    isConnecting?: boolean;
    onProviderSelect?: (provider: any) => void;
    onConnectCancel?: () => void;
    isEnteringKey?: boolean;
    pendingProviderName?: string;
    isSelectingModel?: boolean;
    onModelSelect?: (model: string) => void;
    modelOptions?: { label: string; value: string }[];
}

function ApiKeyInput({ value, onChange, onSubmit }: { value: string, onChange: any, onSubmit: any }) {
    const valRef = React.useRef(value);
    React.useEffect(() => {
        valRef.current = value;
    }, [value]);

    useInput((input, key) => {
        if (key.return) {
            onSubmit(value);
        } else if (key.backspace || key.delete) {
            onChange(value.slice(0, -1));
        } else if (input) {
            // Discard any raw return characters that might be mixed into a paste buffer
            const cleanInput = input.replace(/[\r\n]/g, '');
            if (cleanInput) {
                // Pass a functional callback to guarantee we never use a stale version of the string
                onChange((prev: string) => prev + cleanInput);
            }
            // If the raw input string contained a newline specifically, assume they pressed enter or pasted a terminated block
            if (input.includes('\r') || input.includes('\n')) {
                // Defer the submit by a tick to ensure the functional onChange state has fully flushed and applied
                setTimeout(() => {
                    onSubmit((prev: string) => prev);
                }, 10);
            }
        }
    });

    return (
        <Box width="100%" flexWrap="wrap">
            <Text color="white">{value}<Text color="#32CD32">█</Text></Text>
        </Box>
    );
}

export function ChatMode({ messages, inputValue, onChange, onSubmit, model, isConnecting, onProviderSelect, onConnectCancel, isEnteringKey, pendingProviderName, isSelectingModel, onModelSelect, modelOptions }: ChatModeProps) {
    const providerOptions = [
        { label: 'Anthropic (Claude Max or API key)', value: 'anthropic' },
        { label: 'OpenAI (ChatGPT Plus/Pro or API key)', value: 'openai' },
        { label: 'Google (Gemini 1.5/2.0/2.5)', value: 'google' },
        { label: 'OpenCode (MiniMax or other Models)', value: 'opencode' },
        { label: 'Groq (Llama 3, Mixtral)', value: 'groq' },
        { label: 'OpenRouter (Claude, GPT-4o, etc)', value: 'openrouter' },
        { label: 'Moonshot (Kimi Models)', value: 'moonshot' },
        { label: 'Ollama (Local Models)', value: 'ollama' }
    ];

    const HeaderItem = ({ label }: { label: string }) => (
        <Box marginTop={1} marginBottom={0}>
            <Text bold>{label}</Text>
        </Box>
    );

    const SelectItem = ({ label, isSelected }: { label: string, isSelected?: boolean }) => (
        <Text color={isSelected ? '#32CD32' : 'white'}>
            {label}
        </Text>
    );

    return (
        <Box flexDirection="column">
            <Box flexDirection="column">
                {messages.map((m, i) => {
                    const isLast = i === messages.length - 1;
                    return (
                        <Box key={i} flexDirection="column" marginBottom={1}>
                            {m.role === 'user' ? (
                                <Box borderStyle="round" borderColor="#555" paddingX={1} marginTop={1}>
                                    <Text color="white">{m.content}</Text>
                                </Box>
                            ) : (
                                <Box paddingY={1}>
                                    <TypingText text={m.content} animate={isLast} speed={5} />
                                </Box>
                            )}
                        </Box>
                    );
                })}
            </Box>

            {!isConnecting && !isEnteringKey && !isSelectingModel && (
                <Box flexDirection="column" marginBottom={1}>
                    <Text color="#333333">─────────────────────────────────────────────────────────────────</Text>
                    <Box>
                        <Text color="#32CD32">● </Text><Text color="gray">connected  · {model}  · 0 tokens used</Text>
                    </Box>
                </Box>
            )}

            {isConnecting ? (
                <Box flexDirection="column" padding={1} borderStyle="single" borderColor="gray">
                    <Box justifyContent="space-between" marginBottom={1}>
                        <Text bold>Connect a provider</Text>
                        <Text color="gray">esc</Text>
                    </Box>
                    <SelectInput
                        items={providerOptions}
                        onSelect={(item) => onProviderSelect && onProviderSelect(item.value)}
                        itemComponent={SelectItem}
                    />
                </Box>
            ) : isEnteringKey ? (
                <Box flexDirection="column" padding={1} borderStyle="single" borderColor="#32CD32">
                    <Box marginBottom={1}>
                        <Text bold>Connect to {pendingProviderName}</Text>
                    </Box>
                    <Box flexDirection="column">
                        <Text color="#32CD32">🔑 Paste API Key below:</Text>
                        <Box marginTop={1} paddingX={1} borderStyle="round" borderColor="gray" minHeight={3}>
                            <ApiKeyInput value={inputValue} onChange={onChange} onSubmit={onSubmit} />
                        </Box>
                    </Box>
                    <Box marginTop={1}>
                        <Text color="gray">Press Enter to save, or Esc to cancel.</Text>
                    </Box>
                </Box>
            ) : isSelectingModel ? (
                <Box flexDirection="column" padding={1} borderStyle="single" borderColor="gray">
                    <Box justifyContent="space-between" marginBottom={1}>
                        <Text bold>Select a model</Text>
                        <Text color="gray">esc</Text>
                    </Box>
                    <SelectInput
                        items={modelOptions || []}
                        onSelect={(item) => onModelSelect && onModelSelect(item.value)}
                        itemComponent={SelectItem}
                    />
                </Box>
            ) : (
                <Box borderStyle="round" borderColor="#32CD32" paddingX={1} marginTop={1}>
                    <Box marginRight={1}>
                        <Text color="#32CD32">✍ </Text>
                    </Box>
                    <TextInput value={inputValue} onChange={onChange} onSubmit={onSubmit} />
                </Box>
            )}
        </Box>
    );
}
