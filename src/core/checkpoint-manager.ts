import { promises as fs } from 'fs';
import { join } from 'path';
import type { Message } from '../providers/types.js';
import type { ProviderType } from '../config/config.js';
import type { AgentState } from '../orchestrator/orchestrator.js';
import type { A2ATask } from '../a2a/agent-card.js';

export interface AgentCheckpoint {
    id: string;
    messages: Message[];
    worktreeId?: string;
    worktreeBranch?: string;
    worktreePath?: string;
    status: AgentState['status'];
    subtask: string;
    iteration: number;
}

export interface Checkpoint {
    taskId: string;
    createdAt: number;
    updatedAt: number;
    provider: ProviderType;
    originalTask: string;
    agents: AgentCheckpoint[];
    taskBusTasks: A2ATask[];
    completed: boolean;
}

const CHECKPOINT_DIR = '.codo/checkpoints';

export class CheckpointManager {
    private baseDir: string;

    constructor(cwd?: string) {
        this.baseDir = join(cwd ?? process.cwd(), CHECKPOINT_DIR);
    }

    private taskDir(taskId: string): string {
        return join(this.baseDir, taskId);
    }

    private checkpointPath(taskId: string): string {
        return join(this.taskDir(taskId), 'checkpoint.json');
    }

    /** Save or update a checkpoint. */
    async save(checkpoint: Checkpoint): Promise<void> {
        const dir = this.taskDir(checkpoint.taskId);
        await fs.mkdir(dir, { recursive: true });
        checkpoint.updatedAt = Date.now();
        await fs.writeFile(
            this.checkpointPath(checkpoint.taskId),
            JSON.stringify(checkpoint, null, 2),
            'utf-8',
        );
    }

    /** Load a specific checkpoint by task ID. */
    async load(taskId: string): Promise<Checkpoint | null> {
        try {
            const raw = await fs.readFile(this.checkpointPath(taskId), 'utf-8');
            return JSON.parse(raw) as Checkpoint;
        } catch {
            return null;
        }
    }

    /** Find the most recent incomplete checkpoint. */
    async loadLatest(): Promise<Checkpoint | null> {
        const ids = await this.listIncomplete();
        if (ids.length === 0) return null;

        let latest: Checkpoint | null = null;
        for (const id of ids) {
            const cp = await this.load(id);
            if (cp && (!latest || cp.updatedAt > latest.updatedAt)) {
                latest = cp;
            }
        }
        return latest;
    }

    /** List task IDs of all incomplete checkpoints. */
    async listIncomplete(): Promise<string[]> {
        try {
            const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
            const incomplete: string[] = [];

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const cp = await this.load(entry.name);
                if (cp && !cp.completed) {
                    incomplete.push(entry.name);
                }
            }

            return incomplete;
        } catch {
            return []; // dir doesn't exist yet
        }
    }

    /** Mark a checkpoint as completed and clean it up. */
    async complete(taskId: string): Promise<void> {
        const cp = await this.load(taskId);
        if (cp) {
            cp.completed = true;
            await this.save(cp);
        }
    }

    /** Remove a checkpoint entirely. */
    async remove(taskId: string): Promise<void> {
        try {
            await fs.rm(this.taskDir(taskId), { recursive: true, force: true });
        } catch {
            // Silent — already gone
        }
    }

    /** Remove all completed checkpoints. */
    async cleanup(): Promise<void> {
        try {
            const entries = await fs.readdir(this.baseDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const cp = await this.load(entry.name);
                if (cp?.completed) {
                    await this.remove(entry.name);
                }
            }
        } catch {
            // No checkpoint dir
        }
    }
}
