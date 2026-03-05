import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { A2ABus } from '../a2a/bus.js';
import type { AgentCard, A2AEnvelope, A2AMessageType } from '../a2a/types.js';

export abstract class BaseAgent extends EventEmitter {
    public card: AgentCard;
    public agentId: string;
    protected pendingOffers: Map<string, A2AEnvelope[]> = new Map();
    protected sharedContext: Record<string, unknown> = {};

    constructor(card: AgentCard) {
        super();
        this.card = card;
        this.agentId = card.agentId;

        // Register on the A2A bus
        A2ABus.register(this.card);

        // Subscribe to bus events
        A2ABus.on(`message:${this.agentId}`, this.handleMessage.bind(this));
        A2ABus.on('broadcast', this.handleMessage.bind(this));
    }

    /**
     * Called when the agent is destroyed or finishes its lifecycle
     */
    public destroy(): void {
        A2ABus.unregister(this.agentId);
        A2ABus.off(`message:${this.agentId}`, this.handleMessage.bind(this));
        A2ABus.off('broadcast', this.handleMessage.bind(this));
    }

    /**
     * Core message handler for A2A bus
     */
    private handleMessage(envelope: A2AEnvelope): void {
        // Ignore our own broadcast messages
        if (envelope.params.from === this.agentId) return;

        switch (envelope.method) {
            case 'status':
                // console.debug(`[A2A] Agent ${this.agentId} received status from ${envelope.params.from}`);
                break;

            case 'help_request':
                // Evaluate if this agent can help based on card skills
                const requestedSkills = (envelope.params.payload as any)?.skills as string[] | undefined;
                if (requestedSkills && requestedSkills.some(skill => this.card.skills.includes(skill))) {
                    this.offerHelp(envelope);
                }
                break;

            case 'help_offer':
                const contextId = envelope.params.contextId;
                const offers = this.pendingOffers.get(contextId) || [];
                offers.push(envelope);
                this.pendingOffers.set(contextId, offers);
                break;

            case 'context_share':
                this.sharedContext = { ...this.sharedContext, ...envelope.params.payload };
                break;

            case 'task_done':
                // If this agent is downstream, it triggers onContextReady
                // Assuming if the agent has matching contextId, it needs it.
                // For orchestrator or downstream agents, they'll implement logic here.
                this.onContextReady(envelope.params.contextId, envelope.params.payload);
                break;

            case 'handoff':
                // Re-assign this agent's current task context to incoming payload
                this.handleHandoff(envelope.params.payload);
                break;
        }
    }

    protected offerHelp(requestEnvelope: A2AEnvelope): void {
        this.sendMessage(
            requestEnvelope.params.from,
            'help_offer',
            { canHelp: true, skills: this.card.skills },
            requestEnvelope.params.contextId
        );
    }

    public sendMessage(to: string, method: A2AMessageType, payload: Record<string, unknown>, contextId: string = uuidv4()): void {
        const envelope: A2AEnvelope = {
            jsonrpc: '2.0',
            id: uuidv4(),
            method,
            params: {
                from: this.agentId,
                to,
                contextId,
                payload,
                timestamp: new Date().toISOString()
            }
        };
        A2ABus.send(to, envelope);
    }

    public broadcastMessage(method: A2AMessageType, payload: Record<string, unknown>, contextId: string = uuidv4()): void {
        const envelope: A2AEnvelope = {
            jsonrpc: '2.0',
            id: uuidv4(),
            method,
            params: {
                from: this.agentId,
                to: 'broadcast',
                contextId,
                payload,
                timestamp: new Date().toISOString()
            }
        };
        A2ABus.broadcast(envelope);
    }

    /**
     * Abstract method implemented by concrete agents.
     * Defines what to do when upstream context arrives (e.g., from Orchestrator).
     */
    abstract onContextReady(contextId: string, payload: Record<string, unknown>): void;

    /**
     * Handle handoff event. Concrete agents can override this if needed.
     */
    protected handleHandoff(payload: Record<string, unknown>): void {
        // Default: update context
        this.sharedContext = { ...this.sharedContext, ...payload };
    }
}
