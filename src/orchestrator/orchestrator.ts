import { EventEmitter } from 'events';
import { createAgent, Agent } from '../core/agent.js';

export interface AgentState {
    id: string;
    model: string;
    status: 'idle' | 'running' | 'stuck' | 'done' | 'error';
    currentAction: string;
    startTime?: number;
    endTime?: number;
}

export class Orchestrator extends EventEmitter {
    private agent: Agent | null = null;
    public agentState: AgentState = {
        id: 'agent-1',
        model: 'anthropic',
        status: 'idle',
        currentAction: 'Waiting for tasks...'
    };

    constructor() {
        super();
    }

    async initialize(provider: 'anthropic' | 'google' | 'openai' | 'ollama' = 'anthropic') {
        this.agentState.model = provider;
        this.agent = await createAgent({ provider, emitter: this });
        this.emitState();
    }

    private emitState() {
        this.emit('agent:state', this.agentState);
    }

    public updateState(updates: Partial<AgentState>) {
        this.agentState = { ...this.agentState, ...updates };
        this.emitState();
    }

    async runTask(task: string) {
        if (!this.agent) {
            throw new Error('Orchestrator not initialized');
        }

        this.agentState.startTime = Date.now();
        this.updateState({ status: 'running', currentAction: 'Starting task...' });

        try {
            const result = await this.agent.run(task);
            this.updateState({
                status: 'done',
                currentAction: 'Task completed',
                endTime: Date.now()
            });
            return result;
        } catch (err: any) {
            this.updateState({
                status: 'error',
                currentAction: `Error: ${err.message}`,
                endTime: Date.now()
            });
            throw err;
        }
    }

    // Gracefully stop
    abort() {
        this.updateState({ status: 'done', currentAction: 'Aborted', endTime: Date.now() });
        // If agent supports aborting, call it here
    }
}

// Export a singleton instance
export const orchestrator = new Orchestrator();
