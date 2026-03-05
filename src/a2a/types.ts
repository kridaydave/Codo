export type A2AMessageType =
    | 'status'
    | 'help_request'
    | 'help_offer'
    | 'context_share'
    | 'task_done'
    | 'handoff';

export interface A2AEnvelope {
    jsonrpc: '2.0';
    id: string; // uuid v4
    method: A2AMessageType;
    params: {
        from: string; // agentId of sender
        to: string | 'broadcast'; // agentId of target or 'broadcast'
        contextId: string; // shared task context identifier
        payload: Record<string, unknown>;
        timestamp: string; // ISO 8601 UTC, e.g. "2025-03-05T10:30:00.000Z"
    };
}

export interface A2AExchangeLog {
    timestamp: string;
    from: string;
    to: string | 'broadcast';
    method: A2AMessageType;
    payload: Record<string, unknown>;
}

export interface AgentCard {
    agentId: string;
    name: string;
    description: string;
    skills: string[]; // e.g. ["write_code", "run_tests", "lint"]
    endpoint: string; // internal identifier, e.g. "agent://orchestrator"
    version: '1.0';
}
