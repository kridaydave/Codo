import { EventEmitter } from 'events';
import type { AgentCard, A2AEnvelope, A2AExchangeLog } from './types.js';

class A2ABusClass extends EventEmitter {
    private registry: Map<string, AgentCard> = new Map();
    public _exchangeLog: A2AExchangeLog[] = []; // Exported via getter

    constructor() {
        super();
        // Increase max listeners as many agents might listen to broadcast
        this.setMaxListeners(50);
    }

    register(card: AgentCard): void {
        this.registry.set(card.agentId, card);
        // Let discovery module handle writing to disk if needed, or emit an event
        this.emit('registry:updated');
    }

    unregister(agentId: string): void {
        this.registry.delete(agentId);
        this.emit('registry:updated');
    }

    broadcast(envelope: A2AEnvelope): void {
        this.log(envelope);
        this.emit('broadcast', envelope);
    }

    send(to: string, envelope: A2AEnvelope): void {
        this.log(envelope);
        this.emit(`message:${to}`, envelope);
    }

    getAgents(): AgentCard[] {
        return Array.from(this.registry.values());
    }

    log(envelope: A2AEnvelope): void {
        const entry: A2AExchangeLog = {
            timestamp: envelope.params.timestamp,
            from: envelope.params.from,
            to: envelope.params.to,
            method: envelope.method,
            payload: envelope.params.payload,
        };

        this._exchangeLog.push(entry);

        // Optional: Keep log from growing infinitely in memory during very long runs
        if (this._exchangeLog.length > 1000) {
            this._exchangeLog.shift();
        }
    }
}

// Singleton instance
export const A2ABus = new A2ABusClass();

// Export the shared array directly for the UI component
export const exchangeLog = A2ABus._exchangeLog;
