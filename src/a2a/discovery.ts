import * as fs from 'fs';
import * as path from 'path';
import { A2ABus } from './bus.js';
import type { AgentCard } from './types.js';

const WELL_KNOWN_DIR = path.join(process.cwd(), '.well-known');
const AGENT_JSON_PATH = path.join(WELL_KNOWN_DIR, 'agent.json');

// Ensure directory exists
if (!fs.existsSync(WELL_KNOWN_DIR)) {
    fs.mkdirSync(WELL_KNOWN_DIR, { recursive: true });
}

// Listen for registry changes and write to disk
A2ABus.on('registry:updated', () => {
    try {
        const registryData = dumpAgentRegistry();
        fs.writeFileSync(AGENT_JSON_PATH, registryData, 'utf-8');
    } catch (err) {
        console.error('Failed to write .well-known/agent.json:', err);
    }
});

/**
 * Returns the AgentCard for a given agentId
 */
export function resolveAgentCard(agentId: string): AgentCard | undefined {
    return A2ABus.getAgents().find(card => card.agentId === agentId);
}

/**
 * Returns all registered AgentCards (equivalent of /.well-known/agent.json)
 */
export function listAgentCards(): AgentCard[] {
    return A2ABus.getAgents();
}

/**
 * Serializes the registry to JSON (used for the well-known file mock)
 */
export function dumpAgentRegistry(): string {
    return JSON.stringify(listAgentCards(), null, 2);
}

// Write initially just in case
try {
    fs.writeFileSync(AGENT_JSON_PATH, dumpAgentRegistry(), 'utf-8');
} catch (e) {
    // ignore
}
