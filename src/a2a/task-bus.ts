import { EventEmitter } from 'events';
import type { AgentCard, A2ATask } from './agent-card.js';

export type TaskBusEvent =
    | { type: 'task:submitted'; task: A2ATask }
    | { type: 'task:working'; taskId: string; agentId: string; action: string }
    | { type: 'task:completed'; taskId: string; agentId: string; result: string }
    | { type: 'task:failed'; taskId: string; agentId: string; error: string }
    | { type: 'task:cancelled'; taskId: string }
    | { type: 'agent:registered'; card: AgentCard }
    | { type: 'agent:status'; agentId: string; status: AgentCard['status'] };

/**
 * In-process A2A Task Bus.
 *
 * Implements the A2A protocol task routing pattern for local (same-process) agents.
 * Agents register their AgentCards, and tasks are dispatched to available agents.
 * Status updates flow back through the bus so the UI can track all agents.
 *
 * @see https://a2aproject.github.io/A2A/latest/#/documentation
 */
export class TaskBus extends EventEmitter {
    private agents: Map<string, AgentCard> = new Map();
    private tasks: Map<string, A2ATask> = new Map();

    /** Register an agent with its capabilities. */
    registerAgent(card: AgentCard): void {
        this.agents.set(card.id, card);
        this.emit('bus', { type: 'agent:registered', card });
    }

    /** Update agent status. */
    setAgentStatus(agentId: string, status: AgentCard['status']): void {
        const card = this.agents.get(agentId);
        if (card) {
            card.status = status;
            this.emit('bus', { type: 'agent:status', agentId, status });
        }
    }

    /** Get all registered agent cards. */
    getAgents(): AgentCard[] {
        return Array.from(this.agents.values());
    }

    /** Get an agent card by ID. */
    getAgent(id: string): AgentCard | undefined {
        return this.agents.get(id);
    }

    /** Submit a task to the bus. */
    submitTask(task: A2ATask): void {
        this.tasks.set(task.id, task);
        this.emit('bus', { type: 'task:submitted', task });
    }

    /** Report a task as working (in progress). */
    reportWorking(taskId: string, agentId: string, action: string): void {
        const task = this.tasks.get(taskId);
        if (task) task.state = 'working';
        this.emit('bus', { type: 'task:working', taskId, agentId, action });
    }

    /** Report a task as completed. */
    reportCompleted(taskId: string, agentId: string, result: string): void {
        const task = this.tasks.get(taskId);
        if (task) {
            task.state = 'completed';
            task.result = result;
            task.completedAt = Date.now();
        }
        this.emit('bus', { type: 'task:completed', taskId, agentId, result });
    }

    /** Report a task as failed. */
    reportFailed(taskId: string, agentId: string, error: string): void {
        const task = this.tasks.get(taskId);
        if (task) {
            task.state = 'failed';
            task.error = error;
            task.completedAt = Date.now();
        }
        this.emit('bus', { type: 'task:failed', taskId, agentId, error });
    }

    /** Get all tasks. */
    getTasks(): A2ATask[] {
        return Array.from(this.tasks.values());
    }

    /** Get a specific task. */
    getTask(id: string): A2ATask | undefined {
        return this.tasks.get(id);
    }

    /** Clear completed tasks from memory. */
    clearCompleted(): void {
        for (const [id, task] of this.tasks) {
            if (task.state === 'completed' || task.state === 'failed') {
                this.tasks.delete(id);
            }
        }
    }
}

/** Singleton task bus shared across the application. */
export const taskBus = new TaskBus();
