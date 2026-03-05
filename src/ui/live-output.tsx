import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';

export interface LiveOutputProps {
    agentId: string;
    logs: string[];
}

export function LiveOutput({ agentId, logs }: LiveOutputProps) {
    const [blink, setBlink] = useState(true);

    useEffect(() => {
        const interval = setInterval(() => setBlink(b => !b), 600);
        return () => clearInterval(interval);
    }, []);

    // Show only last 6 lines
    const displayLogs = logs.slice(-6);

    return (
        <Box flexDirection="column">
            <Box>
                <Text bold color="white">▸ LIVE OUTPUT </Text>
                <Text color="gray" dimColor>─────────────────────────────────────────</Text>
            </Box>
            <Box flexDirection="column" minHeight={6} paddingLeft={2}>
                {displayLogs.length === 0 ? (
                    <Box><Text color="gray" dimColor>{blink ? '◎' : ' '}  </Text><Text color="white" wrap="truncate">Thinking...</Text></Box>
                ) : (
                    displayLogs.map((log, i) => {
                        const isLastThinking = log === 'Thinking...' || log.startsWith('Running tool...');
                        if (isLastThinking) {
                            return <Box key={i}><Text color="#32CD32">{blink ? '⠋' : '⠙'}  </Text><Text color="white" wrap="truncate">{log}</Text></Box>;
                        }

                        if (log.startsWith('✎')) {
                            const withoutIcon = log.substring(2).trim();
                            const firstSpace = withoutIcon.indexOf(' ');
                            if (firstSpace !== -1) {
                                const toolName = withoutIcon.substring(0, firstSpace);
                                const rest = withoutIcon.substring(firstSpace + 1).trim();
                                return (
                                    <Box key={i}>
                                        <Text color="yellow">✎  </Text>
                                        <Text color="gray" dimColor wrap="truncate">{toolName.padEnd(14)}</Text>
                                        <Text color="white" wrap="truncate"> {rest}</Text>
                                    </Box>
                                );
                            }
                        } else if (log.startsWith('✓')) {
                            const withoutIcon = log.substring(2).trim();
                            const toolName = withoutIcon.replace('completed', '').trim();
                            return (
                                <Box key={i}>
                                    <Text color="#32CD32">✓  </Text>
                                    <Text color="gray" dimColor wrap="truncate">{toolName.padEnd(14)}</Text>
                                    <Text color="#32CD32"> completed</Text>
                                </Box>
                            );
                        }
                        return (
                            <Box key={i}>
                                <Text color="blue">ℹ  </Text>
                                <Text color="white" wrap="truncate">{log}</Text>
                            </Box>
                        );
                    })
                )}
                {/* Fill remaining lines */}
                {Array.from({ length: Math.max(0, 6 - displayLogs.length) }).map((_, i) => (
                    <Box key={`empty-box-${i}`}><Text key={`empty-${i}`}>{"\u00A0"}</Text></Box>
                ))}
            </Box>
        </Box>
    );
}
