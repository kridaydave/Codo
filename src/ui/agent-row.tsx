import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';
import { useTimer } from './use-timer.js';
import type { AgentState } from '../orchestrator/orchestrator.js';

interface AgentRowProps {
    state: AgentState;
}

export const AgentRow = React.memo(({ state }: AgentRowProps) => {
    const timer = useTimer(state.startTime, state.endTime);
    const [pulse, setPulse] = useState(false);

    useEffect(() => {
        if (state.status !== 'stuck') return;
        const interval = setInterval(() => setPulse(p => !p), 500);
        return () => clearInterval(interval);
    }, [state.status]);

    let statusIcon = '💤';
    let statusColor = 'gray';
    let statusText = 'IDLE';

    switch (state.status) {
        case 'running':
            statusIcon = '🟢';
            statusColor = 'green';
            statusText = 'RUNNING';
            break;
        case 'done':
            statusIcon = '✅';
            statusColor = 'greenBright';
            statusText = 'DONE';
            break;
        case 'stuck':
        case 'error':
            statusIcon = '🔴';
            statusColor = 'red';
            statusText = state.status === 'stuck' ? 'STUCK' : 'ERROR';
            break;
    }

    return (
        <Box flexDirection="column" marginBottom={1}>
            <Box>
                <Text>{statusIcon}  </Text>
                <Text bold color="white">{state.id}</Text>
                <Text color="gray">  ·  {state.model}/flash          </Text>
                <Text color={statusColor} dimColor={state.status === 'stuck' && !pulse}>{statusText.padEnd(9)}</Text>
                <Text color="gray" dimColor>{state.startTime ? timer : ''}</Text>
                {state.status === 'stuck' && <Text color="yellow">  ⚠</Text>}
            </Box>
            <Box paddingLeft={4}>
                <Text color="gray" dimColor>↳ {state.currentAction}</Text>
            </Box>
        </Box>
    );
});
