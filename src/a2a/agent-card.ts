/**
 * A2A-inspired Agent Card — describes an agent's identity and capabilities.
 * Based on the Google A2A protocol spec, adapted for in-process use.
 * @see https://a2aproject.github.io/A2A/latest/#/documentation
 */
export interface AgentCard {
    /** Unique agent identifier, e.g. "agent-1" */
    id: string;
    /** Human-readable name */
    name: string;
    /** What this agent specializes in */
    description: string;
    /** Skill tags, e.g. ['file-edit', 'shell', 'refactor', 'test'] */
    skills: string[];
    /** Current availability */
    status: 'available' | 'busy' | 'offline';
    /** Provider/model backing this agent */
    model: string;
    /** Optional worktree path for file isolation */
    worktreeDir?: string;
}

/**
 * A2A Task — represents a unit of work assigned to an agent.
 */
export interface A2ATask {
    /** Unique task ID */
    id: string;
    /** The task description / prompt */
    instruction: string;
    /** Which agent is handling it */
    assignedTo: string;
    /** Task lifecycle state */
    state: 'submitted' | 'working' | 'completed' | 'failed' | 'cancelled';
    /** Result when completed */
    result?: string;
    /** Error when failed */
    error?: string;
    /** Timestamps */
    submittedAt: number;
    completedAt?: number;
}

/**
 * A2A Message — represents a single communication between agents.
 */
export interface A2AMessage {
    /** Unique message ID */
    id: string;
    /** Sender agent ID */
    from: string;
    /** Recipient agent ID (or 'broadcast' for all) */
    to: string | 'broadcast';
    /** The message content */
    content: string;
    /** Optional context summary for token optimization */
    contextSummary?: string;
    /** Timestamp */
    timestamp: number;
}

/**
 * Create a default Agent Card for a given agent ID and provider.
 */
export function createAgentCard(id: string, model: string): AgentCard {
    return {
        id,
        name: `Codo ${id}`,
        description: 'General-purpose coding agent with file system and shell access',
        skills: ['file-edit', 'file-create', 'shell', 'refactor', 'debug', 'test'],
        status: 'available',
        model,
    };
}

/**
 * Create a unique task ID.
 */
export function createTaskId(agentId: string): string {
    return `task-${agentId}-${Date.now()}`;
}
