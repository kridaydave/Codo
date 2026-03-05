import { BaseAgent } from '../agents/BaseAgent.js';
import type { AgentCard, A2AEnvelope } from './types.js';
import { A2ABus } from './bus.js';

// 1. Mock Agent 1 (Worker)
class MockAgent1 extends BaseAgent {
    constructor() {
        super({
            agentId: 'agent1',
            name: 'Agent 1',
            description: 'Writes code',
            skills: ['write_code'],
            endpoint: 'agent://agent1',
            version: '1.0'
        });
    }

    onContextReady(contextId: string, payload: Record<string, unknown>): void {
        // Not expecting upstream context in this mock
    }

    simulateFinish(contextId: string) {
        this.broadcastMessage('task_done', { code: 'function add(a,b){return a+b}' }, contextId);
    }
}

// 2. Mock Agent 2 (Worker)
class MockAgent2 extends BaseAgent {
    constructor() {
        super({
            agentId: 'agent2',
            name: 'Agent 2',
            description: 'Runs tests',
            skills: ['run_tests'],
            endpoint: 'agent://agent2',
            version: '1.0'
        });
    }

    onContextReady(contextId: string, payload: Record<string, unknown>): void {
        console.log(`Agent2 received context:`, this.sharedContext);
        // 6. Script exits cleanly with process.exit(0) if Agent2 logged correctly
        if (this.sharedContext.code === 'function add(a,b){return a+b}') {
            process.exit(0);
        } else {
            console.error('Failed to receive correct context in Agent 2');
            process.exit(1);
        }
    }
}

// 3. Mock Orchestrator
class MockOrchestrator extends BaseAgent {
    constructor() {
        super({
            agentId: 'orchestrator',
            name: 'Orchestrator',
            description: 'Coordinates tasks',
            skills: [],
            endpoint: 'agent://orchestrator',
            version: '1.0'
        });
    }

    onContextReady(contextId: string, payload: Record<string, unknown>): void {
        // Orchestrator intercepts task_done and forwards
        // Note: Orchestrator receives task_done through standard broadcast or direct depending on emitting
    }

    // Override handleMessage for orchestrator specific behavior
    private handleOrchMessage(envelope: A2AEnvelope) {
        if (envelope.params.from === this.agentId) return;

        if (envelope.method === 'task_done' && envelope.params.from === 'agent1') {
            const payload = envelope.params.payload;
            const contextId = envelope.params.contextId;

            // Automatically forward to next agent (agent2)
            this.sendMessage('agent2', 'context_share', payload, contextId);
            this.sendMessage('agent2', 'task_done', { ready: true, contextId }, contextId);
        }
    }

    // Add the custom listener
    public init() {
        A2ABus.on('broadcast', this.handleOrchMessage.bind(this));
    }
}

// --- Run the test ---
const orchestrator = new MockOrchestrator();
orchestrator.init();

const agent1 = new MockAgent1();
const agent2 = new MockAgent2();

const fakeContextId = 'ctx-123';

console.log('Simulating Agent 1 finishing task...');
// Agent 1 simulates finishing a task
agent1.simulateFinish(fakeContextId);

// Timeout to fail if it doesn't work under 3 seconds
setTimeout(() => {
    console.log('Smoke test timed out');
    process.exit(1);
}, 2900);
