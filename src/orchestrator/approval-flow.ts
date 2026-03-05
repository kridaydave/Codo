import { EventEmitter } from 'events';
import type { DiffResult } from '../git/index.js';

export interface ApprovalRequest {
    worktreeId: string;
    task: string;
    diff: DiffResult;
    agentSummary: string;
}

export interface ApprovalDecision {
    decision: 'merge' | 'cancel';
    comment?: string;
}

/**
 * ApprovalFlow manages the user approval process for worktree changes.
 * It emits events to communicate with the UI and waits for user decisions.
 */
export class ApprovalFlow extends EventEmitter {
    private queue: { request: ApprovalRequest; resolve: (decision: ApprovalDecision) => void }[] = [];
    private isPrompting = false;

    /**
     * Request approval from the user. Emits 'approval:request' event
     * and returns a promise that resolves when the user makes a decision.
     */
    async requestApproval(request: ApprovalRequest): Promise<ApprovalDecision> {
        return new Promise<ApprovalDecision>((resolve) => {
            this.queue.push({ request, resolve });
            this._processNext();
        });
    }

    private _processNext(): void {
        if (this.isPrompting || this.queue.length === 0) {
            return;
        }

        this.isPrompting = true;
        const current = this.queue[0];
        this.emit('approval:request', current.request);
    }

    /**
     * Submit a decision (called by the UI when user makes a choice).
     */
    submitDecision(decision: ApprovalDecision): void {
        if (this.queue.length > 0) {
            const current = this.queue.shift();
            if (current) {
                this.emit('approval:complete', decision);
                current.resolve(decision);
            }
        }

        this.isPrompting = false;
        // Schedule next prompt if any (using setTimeout to allow UI to breathe)
        setTimeout(() => this._processNext(), 100);
    }

    /**
     * Check if there is a pending approval request.
     */
    hasPendingApproval(): boolean {
        return this.queue.length > 0;
    }

    /**
     * Cancel any pending approval (e.g., on abort).
     */
    cancelPending(): void {
        const queuedItems = [...this.queue];
        this.queue = [];
        this.isPrompting = false;

        for (const item of queuedItems) {
            item.resolve({ decision: 'cancel', comment: 'Aborted by user' });
        }
    }
}
