import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { A2ABus, exchangeLog } from '../a2a/bus.js';
import type { A2AExchangeLog, A2AMessageType } from '../a2a/types.js';

const getColorForMethod = (method: A2AMessageType): string => {
    switch (method) {
        case 'task_done':
            return 'green';
        case 'help_request':
            return 'yellow';
        case 'handoff':
            return 'magenta';
        case 'context_share':
            return 'cyan';
        case 'help_offer':
            return 'blue';
        case 'status':
        default:
            return 'gray';
    }
};

export const A2AFeed: React.FC = () => {
    const [logs, setLogs] = useState<A2AExchangeLog[]>([]);

    useEffect(() => {
        // Initial load, copy array and limit to 50, reverse to show newest first
        const updateLogs = () => {
            setLogs([...exchangeLog].slice(-50).reverse());
        };

        updateLogs();

        // Re-render when bus logs a message
        const handleBroadcast = () => updateLogs();

        // Listen to wildcards or we can have bus emit a log event
        // The spec didn't specify a log event, but any message/broadcast means log was updated
        A2ABus.on('broadcast', handleBroadcast);
        // Actually, listening to 'registry:updated' isn't right for messages.
        // Instead of intercepting every 'message:*', we can wrap the log function directly, 
        // or add 'bus:log' event in bus.ts. Since we can't easily intercept all message:* dynamically 
        // without hacking, we can poll, but polling is ugly.
        // Let's patch `A2ABus.log` to emit a feed update event since JS classes are mutable.

        const originalLog = A2ABus.log.bind(A2ABus);
        A2ABus.log = (envelope) => {
            originalLog(envelope);
            setLogs([...exchangeLog].slice(-50).reverse());
        };

        return () => {
            A2ABus.log = originalLog;
            A2ABus.off('broadcast', handleBroadcast);
        };
    }, []);

    if (logs.length === 0) {
        return null;
    }

    return (
        <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginBottom={1}>
            <Box marginBottom={1}>
                <Text bold>── A2A Live Feed ──</Text>
            </Box>
            <Box flexDirection="column">
                {logs.map((log, index) => {
                    const timestamp = new Date(log.timestamp).toLocaleTimeString();
                    const payloadSummary = JSON.stringify(log.payload).slice(0, 80);

                    return (
                        <Box key={`${log.timestamp}-${index}`}>
                            <Text color="gray">[{timestamp}] </Text>
                            <Text color="white">
                                {log.from} → {log.to}{' '}
                            </Text>
                            <Text color={getColorForMethod(log.method)} bold>
                                {log.method}
                            </Text>
                            <Text color="gray"> {payloadSummary}</Text>
                        </Box>
                    );
                })}
            </Box>
        </Box>
    );
};
